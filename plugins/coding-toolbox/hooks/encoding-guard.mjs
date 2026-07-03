#!/usr/bin/env node
// PreToolUse encoding guard: denies Read/Edit/Write/Bash operations that
// would read or modify the content of a non-UTF-8 text file with
// UTF-8-assuming tools, naming the detected encoding and an iconv-based safe
// path. Fail-open by design: any uncertainty, parse failure, or internal
// error exits 0 with no output so the user is never stranded.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/** @typedef {{path: string, label: string, iconv: string}} Offender */
/** @typedef {{safe: true} | {safe: false, label: string, iconv: string}} Classification */

const SAMPLE_BYTES = 64 * 1024;
const STDIN_CAP = 1024 * 1024;
const SENTINEL = "\u0001"; // written as an escape: a literal control char is invisible and copy-fragile

// Tools whose file arguments / input redirects consume or transform text
// content assuming the ambient (UTF-8) encoding. Output-redirect targets are
// checked regardless of the command word. Everything not listed (iconv,
// recode, git, mv, cp, rm, ls, cc-tools, ...) passes — unknown tools fail
// open by contract.
const CONTENT_TOOLS = new Set([
  "cat", "head", "tail", "more", "less", "nl", "tac", "rev",
  "grep", "egrep", "fgrep", "rg",
  "sed", "awk", "gawk", "mawk", "nawk",
  "cut", "tr", "sort", "uniq", "paste", "join", "comm", "column",
  "fold", "fmt", "expand", "unexpand", "strings",
  "diff", "patch", "tee", "dos2unix", "unix2dos",
]);

main();

/** @returns {void} */
function main() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (raw.length > STDIN_CAP) return;
    /** @type {ToolHookInput} */
    const input = JSON.parse(raw);
    const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
    const offenders = collectOffenders(input, cwd);
    if (offenders.length > 0) {
      process.stdout.write(JSON.stringify(denyResult(offenders)) + "\n");
    }
  } catch (e) {
    if (process.env.ENCODING_GUARD_DEBUG) {
      process.stderr.write(`encoding-guard: ${e instanceof Error ? e.message : String(e)}\n`);
    }
    // fail open — exit 0 with no output
  }
}

/**
 * @param {ToolHookInput} input
 * @param {string} cwd
 * @returns {Offender[]}
 */
function collectOffenders(input, cwd) {
  const ti = input.tool_input;
  if (input.tool_name === "Read" || input.tool_name === "Edit" || input.tool_name === "Write") {
    const fp = ti ? ti.file_path : undefined;
    if (typeof fp !== "string" || fp === "") return [];
    const abs = resolvePath(fp, cwd);
    const c = classifyFile(abs);
    return c.safe ? [] : [{ path: abs, label: c.label, iconv: c.iconv }];
  }
  if (input.tool_name === "Bash") {
    const cmd = ti ? ti.command : undefined;
    if (typeof cmd !== "string" || cmd === "") return [];
    return analyzeBash(cmd, cwd);
  }
  return [];
}

/**
 * Bash analysis lands in the follow-up task; until then Bash always passes
 * (fail open).
 * @param {string} _cmd
 * @param {string} _cwd
 * @returns {Offender[]}
 */
function analyzeBash(_cmd, _cwd) {
  return [];
}

/**
 * Expand a leading `~` and resolve against the hook-provided cwd.
 * @param {string} p
 * @param {string} cwd
 * @returns {string}
 */
function resolvePath(p, cwd) {
  let expanded = p;
  if (p === "~" || p.startsWith("~/")) {
    const home = process.env.HOME;
    if (home) expanded = path.join(home, p.slice(1));
  }
  return path.resolve(cwd, expanded);
}

/**
 * Classify a file by sampling its first 64 KiB. Missing files, non-files,
 * empty files and anything unreadable are safe (fail open).
 * @param {string} filePath
 * @returns {Classification}
 */
function classifyFile(filePath) {
  /** @type {number | undefined} */
  let fd;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return { safe: true };
    fd = fs.openSync(filePath, "r");
    const len = Math.min(stat.size, SAMPLE_BYTES);
    const buf = Buffer.alloc(len);
    const got = fs.readSync(fd, buf, 0, len, 0);
    return classifyBuffer(buf.subarray(0, got), got < stat.size);
  } catch {
    return { safe: true };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

/**
 * BOM sniff → NUL analysis (UTF-16 parity heuristic vs. binary) → strict
 * UTF-8 validation → legacy single-byte fallback. NUL analysis MUST run
 * before UTF-8 validation: NUL is a *valid* UTF-8 byte, so ASCII-content
 * UTF-16 without a BOM would otherwise pass as UTF-8 and slip through.
 * @param {Buffer} buf
 * @param {boolean} truncated  true when the sample is a prefix of a larger file
 * @returns {Classification}
 */
function classifyBuffer(buf, truncated) {
  if (startsWith(buf, [0xff, 0xfe, 0x00, 0x00])) return unsafe("UTF-32LE", "UTF-32LE");
  if (startsWith(buf, [0x00, 0x00, 0xfe, 0xff])) return unsafe("UTF-32BE", "UTF-32BE");
  if (startsWith(buf, [0xef, 0xbb, 0xbf])) return { safe: true }; // UTF-8 BOM round-trips
  if (startsWith(buf, [0xff, 0xfe])) return unsafe("UTF-16LE", "UTF-16LE");
  if (startsWith(buf, [0xfe, 0xff])) return unsafe("UTF-16BE", "UTF-16BE");
  let nuls = 0;
  let evenNuls = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) {
      nuls++;
      if (i % 2 === 0) evenNuls++;
    }
  }
  if (nuls > 0) {
    // ASCII-heavy UTF-16 puts its NUL high bytes on one parity side:
    // LE = odd indexes, BE = even indexes. Require a clear skew so
    // NUL-bearing binary data (images, archives) stays "binary" → safe.
    const evenRatio = evenNuls / nuls;
    if (nuls / buf.length >= 0.3 && (evenRatio >= 0.7 || evenRatio <= 0.3)) {
      return evenRatio >= 0.7
        ? unsafe("UTF-16BE (no BOM)", "UTF-16BE")
        : unsafe("UTF-16LE (no BOM)", "UTF-16LE");
    }
    return { safe: true };
  }
  if (isValidUtf8(buf, truncated)) return { safe: true };
  return unsafe("ISO-8859-1/Windows-1252 (legacy single-byte)", "WINDOWS-1252");
}

/**
 * @param {string} label
 * @param {string} iconv
 * @returns {Classification}
 */
function unsafe(label, iconv) {
  return { safe: false, label, iconv };
}

/**
 * @param {Buffer} buf
 * @param {number[]} bytes
 * @returns {boolean}
 */
function startsWith(buf, bytes) {
  if (buf.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * Strict UTF-8 validation (overlongs, surrogates and >U+10FFFF rejected). A
 * multibyte sequence cut off at the end of a truncated sample is tolerated —
 * that is a sampling artifact, not an encoding error.
 * @param {Buffer} buf
 * @param {boolean} truncated
 * @returns {boolean}
 */
function isValidUtf8(buf, truncated) {
  const n = buf.length;
  let i = 0;
  while (i < n) {
    const b = buf[i];
    if (b < 0x80) {
      i += 1;
      continue;
    }
    let need;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) need = 2;
    else if (b >= 0xf0 && b <= 0xf4) need = 3;
    else return false;
    if (i + need >= n) return truncated; // sequence runs past the sample end
    const c1 = buf[i + 1];
    if ((c1 & 0xc0) !== 0x80) return false;
    if (b === 0xe0 && c1 < 0xa0) return false; // overlong
    if (b === 0xed && c1 > 0x9f) return false; // surrogate half
    if (b === 0xf0 && c1 < 0x90) return false; // overlong
    if (b === 0xf4 && c1 > 0x8f) return false; // above U+10FFFF
    for (let k = 2; k <= need; k++) {
      if ((buf[i + k] & 0xc0) !== 0x80) return false;
    }
    i += need + 1;
  }
  return true;
}

/**
 * Build the PreToolUse deny JSON. The reason always names every offending
 * file with its detected encoding and gives one concrete iconv command line.
 * @param {Offender[]} offenders
 * @returns {HookResult}
 */
function denyResult(offenders) {
  const list = offenders.map((o) => `${o.path} (${o.label})`).join(", ");
  const first = offenders[0];
  const reason =
    `encoding-guard: ${list} ${offenders.length === 1 ? "is" : "are"} not UTF-8. ` +
    "Native Read/Edit/Write and plain shell text tools assume UTF-8 and would misread or corrupt the content. " +
    `Read safely with: iconv -f ${first.iconv} -t UTF-8 '${first.path}'. ` +
    `To modify: convert to UTF-8, edit, convert back with iconv -f UTF-8 -t ${first.iconv} — or use another encoding-preserving tool.`;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}
