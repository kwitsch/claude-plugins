// Pure, zero-dep logic behind coding-toolbox's mods hooks module (register.ts).
// Never references the mods API `$`: register.ts hands every file-system or
// process effect in through the small `io` objects below, so node:test can drive
// the same code with node:fs / child_process.

/** @typedef {{path: string, label: string, iconv: string}} Offender */
/** @typedef {{safe: true} | {safe: false, label: string, iconv: string}} Classification */
/** @typedef {{kind: string, size: number}} FileStat */
/**
 * File access the encoding guard needs. `stat` follows links; `sample` answers
 * the file's first `min(size, SAMPLE_BYTES)` bytes. Either may throw: the file
 * then counts as safe (fail open).
 * @typedef {{stat: (path: string) => Promise<FileStat>, sample: (path: string, size: number) => Promise<Uint8Array>}} GuardIo
 */
/** @typedef {{tool: string, file_path?: unknown, command?: unknown}} GuardedCall */
/** @typedef {{exitCode: number, stdout: string, stderr: string}} RunResult */
/**
 * Effects the worktree refresh needs. `git` runs `git <args>` in `cwd` and may
 * reject (timeout); `realPath` resolves every symbolic link of an absolute path.
 * @typedef {{git: (cwd: string, args: string[]) => Promise<RunResult>, realPath: (path: string) => Promise<string>}} RefreshIo
 */

export const SAMPLE_BYTES = 64 * 1024;
// Files up to this size are read whole (the mods fs read has no range) and sliced;
// larger ones are sampled through `head -c`, so a huge log never crosses the
// worker boundary in full.
export const FULL_READ_MAX = 1024 * 1024;
const SENTINEL = "\u0001"; // written as an escape: a literal control char is invisible and copy-fragile

// Tools whose file arguments / input redirects consume or transform text
// content assuming the ambient (UTF-8) encoding. Output-redirect targets are
// checked regardless of the command word. Everything not listed (iconv,
// recode, git, mv, cp, rm, ls, cc-tools, ...) passes — unknown tools fail
// open by contract.
const CONTENT_TOOLS = new Set([
  "cat",
  "head",
  "tail",
  "more",
  "less",
  "nl",
  "tac",
  "rev",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "sed",
  "awk",
  "gawk",
  "mawk",
  "nawk",
  "cut",
  "tr",
  "sort",
  "uniq",
  "paste",
  "join",
  "comm",
  "column",
  "fold",
  "fmt",
  "expand",
  "unexpand",
  "strings",
  "diff",
  "patch",
  "tee",
  "dos2unix",
  "unix2dos",
]);

// ---------------------------------------------------------------------------
// Encoding guard (tool.call on Read|Edit|Write|Bash)
// ---------------------------------------------------------------------------

/**
 * Offending files of one guarded tool call: the file a Read/Edit/Write names,
 * or the literal Bash tokens a content tool reads or a redirect writes, that
 * classify as non-UTF-8 text. Unknown tools and missing arguments pass.
 * @param {GuardedCall} call  the `tool.call` event (tool arguments spread on it)
 * @param {string} cwd  the session's working directory (absolute)
 * @param {string | undefined} home  `$HOME`, for a leading `~`
 * @param {GuardIo} io
 * @returns {Promise<Offender[]>}
 */
export async function collectOffenders(call, cwd, home, io) {
  if (call.tool === "Read" || call.tool === "Edit" || call.tool === "Write") {
    const fp = call.file_path;
    if (typeof fp !== "string" || fp === "") return [];
    const abs = resolvePath(fp, cwd, home);
    const c = await classifyFile(abs, io);
    return c.safe ? [] : [{ path: abs, label: c.label, iconv: c.iconv }];
  }
  if (call.tool === "Bash") {
    const cmd = call.command;
    if (typeof cmd !== "string" || cmd === "") return [];
    /** @type {Map<string, Offender>} */
    const found = new Map();
    for (const tok of bashCandidates(cmd)) {
      const abs = resolvePath(tok, cwd, home);
      if (found.has(abs)) continue;
      const c = await classifyFile(abs, io);
      if (!c.safe) found.set(abs, { path: abs, label: c.label, iconv: c.iconv });
    }
    return [...found.values()];
  }
  return [];
}

/**
 * Precision-biased Bash command analysis: the clean literal tokens that (a) are
 * output-redirect targets, or (b) are arguments / input-redirect targets of a
 * known content tool, in order, duplicates kept (the caller dedups by resolved
 * path). False negatives are acceptable; false positives are not — non-literal
 * tokens (quotes, substitutions, variables, globs) and options are dropped and
 * unknown tools pass (fail open).
 * @param {string} cmd
 * @returns {string[]}
 */
export function bashCandidates(cmd) {
  const sanitized = blankNonLiterals(stripHeredocBodies(cmd))
    .replace(/\d*>&\d*/g, " ") // fd duplication (2>&1) — never a file
    .replace(/&>>/g, ">>")
    .replace(/&>/g, ">")
    .replace(/>\|/g, "> ")
    .replace(/\|&/g, "|");
  /** @type {string[]} */
  const out = [];
  for (const segment of sanitized.split(/\n|;|\|\||&&|\||&/)) {
    const { cmdWord, args, outTargets, inTargets } = parseSegment(segment);
    const candidates = [...outTargets];
    if (cmdWord !== null && CONTENT_TOOLS.has(cmdWord)) {
      candidates.push(...args, ...inTargets);
    }
    for (const tok of candidates) {
      if (isLiteralPathToken(tok)) out.push(tok);
    }
  }
  return out;
}

/**
 * Remove heredoc body lines (they are data, not commands) while keeping the
 * operator lines. Supports multiple heredocs queued on one line and `<<-`
 * tab-stripped closing delimiters; quoted delimiters match their unquoted
 * form. Here-strings (`<<<`) are not heredocs and are left alone.
 * @param {string} text
 * @returns {string}
 */
function stripHeredocBodies(text) {
  /** @type {string[]} */
  const kept = [];
  /** @type {{delim: string, stripTabs: boolean}[]} */
  const queue = [];
  /** @type {{delim: string, stripTabs: boolean} | null} */
  let body = null;
  for (const line of text.split("\n")) {
    if (body !== null) {
      const probe = body.stripTabs ? line.replace(/^\t+/, "") : line;
      if (probe === body.delim) body = queue.shift() ?? null;
      continue; // body lines and the closing delimiter are dropped
    }
    kept.push(line);
    const re = /(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z0-9_][A-Za-z0-9_-]*)\2/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      queue.push({ delim: m[3], stripTabs: m[1] === "-" });
    }
    body = queue.shift() ?? null;
  }
  return kept.join("\n");
}

/**
 * Blank the contents of quotes, command/process substitutions, backslash
 * escapes and comments with a sentinel: word boundaries survive, but any
 * token that contained them is recognizably non-literal and gets skipped.
 * @param {string} text
 * @returns {string}
 */
function blankNonLiterals(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const c2 = i + 1 < n ? text[i + 1] : "";
    if (c === "\\") {
      out += SENTINEL;
      i += 2;
      continue;
    }
    if (c === "'") {
      out += SENTINEL;
      i = skipPast(text, i + 1, "'");
      continue;
    }
    if (c === "$" && c2 === "'") {
      out += SENTINEL;
      i = skipEscaped(text, i + 2, "'");
      continue;
    }
    if (c === '"') {
      out += SENTINEL;
      i = skipEscaped(text, i + 1, '"');
      continue;
    }
    if (c === "$" && c2 === "(") {
      out += SENTINEL;
      i = skipParens(text, i + 2);
      continue;
    }
    if (c === "`") {
      out += SENTINEL;
      i = skipPast(text, i + 1, "`");
      continue;
    }
    if ((c === "<" || c === ">") && c2 === "(") {
      out += SENTINEL;
      i = skipParens(text, i + 2);
      continue;
    }
    if (c === "#" && (out === "" || /[\s;|&(]/.test(out[out.length - 1]))) {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * @param {string} text
 * @param {number} from
 * @param {string} ch
 * @returns {number} index just past the closing char (or end of string)
 */
function skipPast(text, from, ch) {
  const idx = text.indexOf(ch, from);
  return idx === -1 ? text.length : idx + 1;
}

/**
 * Quote scanner honoring backslash escapes, for "…" and ANSI-C $'…'.
 * @param {string} text
 * @param {number} from
 * @param {string} quote  the closing quote character
 * @returns {number} index just past the closing quote (or end of string)
 */
function skipEscaped(text, from, quote) {
  let i = from;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

/**
 * Paren scanner with nesting, for $(…), <(…), >(…).
 * @param {string} text
 * @param {number} from  index just past the opening paren
 * @returns {number} index just past the matching close (or end of string)
 */
function skipParens(text, from) {
  let depth = 1;
  let i = from;
  while (i < text.length && depth > 0) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") depth -= 1;
    i += 1;
  }
  return i;
}

/** @typedef {{cmdWord: string | null, args: string[], outTargets: string[], inTargets: string[]}} ParsedSegment */

/**
 * Split one pipeline segment into command word (basename, env-assignment
 * prefixes skipped), plain arguments, and redirect targets. Heredoc (`<<`)
 * and here-string (`<<<`) operators never produce a file target;
 * fd-duplication targets (`>&2`) are dropped.
 * @param {string} segment
 * @returns {ParsedSegment}
 */
function parseSegment(segment) {
  /** @type {string[]} */ const args = [];
  /** @type {string[]} */ const outTargets = [];
  /** @type {string[]} */ const inTargets = [];
  /** @type {string | null} */ let cmdWord = null;
  /** @type {"out" | "in" | "skip" | null} */ let pending = null;
  for (const tok of segment.trim().split(/\s+/)) {
    if (tok === "") continue;
    if (pending === "out") {
      outTargets.push(tok);
      pending = null;
      continue;
    }
    if (pending === "in") {
      inTargets.push(tok);
      pending = null;
      continue;
    }
    if (pending === "skip") {
      pending = null;
      continue;
    }
    const m = tok.match(/^(\d*)(<<<|<<|>>|>|<)(.*)$/);
    if (m) {
      const op = m[2];
      const rest = m[3];
      if (op === "<<" || op === "<<<") {
        // heredoc delimiter (<<) or here-string operand (<<<) — never a file
        // path. Attached operand (rest !== "") is data, dropped here; when
        // detached (rest === "") the operand is the next token, also skipped.
        if (rest === "") pending = "skip";
        continue;
      }
      if (rest === "") {
        pending = op === "<" ? "in" : "out";
        continue;
      }
      if (rest.startsWith("&")) continue; // fd duplication, not a file
      (op === "<" ? inTargets : outTargets).push(rest);
      continue;
    }
    if (cmdWord === null) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) continue; // env prefix
      cmdWord = tok.slice(tok.lastIndexOf("/") + 1);
      continue;
    }
    args.push(tok);
  }
  return { cmdWord, args, outTargets, inTargets };
}

/**
 * A clean literal path token: sentinel residue, `$` variables, options and
 * glob characters reject it (fail open). Whether it names an existing regular
 * file is `classifyFile`'s business.
 * @param {string} tok
 * @returns {boolean}
 */
function isLiteralPathToken(tok) {
  if (tok === "" || tok.includes(SENTINEL) || tok.includes("$")) return false;
  if (tok.startsWith("-")) return false; // option
  return !/[*?[\]{}]/.test(tok); // glob — expansion unknown
}

/**
 * POSIX `path.resolve(cwd, p)` with a leading `~` expanded to `home`.
 * @param {string} p
 * @param {string} cwd  absolute
 * @param {string | undefined} home
 * @returns {string}
 */
export function resolvePath(p, cwd, home) {
  let expanded = p;
  if (home && (p === "~" || p.startsWith("~/"))) expanded = home + p.slice(1);
  const joined = expanded.startsWith("/") ? expanded : `${cwd}/${expanded}`;
  /** @type {string[]} */
  const parts = [];
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join("/")}`;
}

/**
 * Classify a file by its first 64 KiB. Missing files, non-files, empty files
 * and anything unreadable are safe (fail open).
 * @param {string} filePath  absolute
 * @param {GuardIo} io
 * @returns {Promise<Classification>}
 */
export async function classifyFile(filePath, io) {
  try {
    const st = await io.stat(filePath);
    if (st.kind !== "file" || st.size === 0) return { safe: true };
    const buf = await io.sample(filePath, st.size);
    const got = Math.min(buf.length, SAMPLE_BYTES);
    return classifyBytes(buf.subarray(0, got), got < st.size);
  } catch {
    return { safe: true };
  }
}

/**
 * BOM sniff → NUL analysis (UTF-16 parity heuristic vs. binary) → strict
 * UTF-8 validation → legacy single-byte fallback. NUL analysis MUST run
 * before UTF-8 validation: NUL is a *valid* UTF-8 byte, so ASCII-content
 * UTF-16 without a BOM would otherwise pass as UTF-8 and slip through.
 * @param {Uint8Array} buf
 * @param {boolean} truncated  true when the sample is a prefix of a larger file
 * @returns {Classification}
 */
export function classifyBytes(buf, truncated) {
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
      return evenRatio >= 0.7 ? unsafe("UTF-16BE (no BOM)", "UTF-16BE") : unsafe("UTF-16LE (no BOM)", "UTF-16LE");
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
 * @param {Uint8Array} buf
 * @param {number[]} bytes
 * @returns {boolean}
 */
function startsWith(buf, bytes) {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

/**
 * Strict UTF-8 validation (overlongs, surrogates and >U+10FFFF rejected). A
 * multibyte sequence cut off at the end of a truncated sample is tolerated —
 * that is a sampling artifact, not an encoding error.
 * @param {Uint8Array} buf
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
 * The deny reason: every offending file with its detected encoding, and one
 * concrete iconv command line.
 * @param {Offender[]} offenders  non-empty
 * @returns {string}
 */
export function denyReason(offenders) {
  const list = offenders.map((o) => `${o.path} (${o.label})`).join(", ");
  const first = offenders[0];
  return (
    `encoding-guard: ${list} ${offenders.length === 1 ? "is" : "are"} not UTF-8. ` +
    "Native Read/Edit/Write and plain shell text tools assume UTF-8 and would misread or corrupt the content. " +
    `Read safely with: iconv -f ${first.iconv} -t UTF-8 '${first.path}'. ` +
    `To modify: convert to UTF-8, edit, convert back with iconv -f UTF-8 -t ${first.iconv} — or use another encoding-preserving tool.`
  );
}

/**
 * Decode base64 (whitespace tolerated, as `atob` strips it) to bytes.
 * @param {string} b64
 * @returns {Uint8Array}
 */
export function decodeBase64(b64) {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
