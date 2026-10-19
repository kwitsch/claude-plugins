// encoding guard (tool.call deny gate on Read|Edit|Write|Bash) — the pure logic in
// plugins/coding-toolbox/hooks/policy.mjs, driven with real fixture files through node:fs.
// Hook wiring (the deny reaching the model) is covered by plugins/coding-toolbox/tests/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, openSync, readSync, closeSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SAMPLE_BYTES, bashCandidates, classifyBytes, collectOffenders, decodeBase64, denyReason, resolvePath } from "../../plugins/coding-toolbox/hooks/policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// "Täglich grüßt der Bär" in Windows-1252.
const LEGACY = Uint8Array.from("T\xe4glich gr\xfc\xdft der B\xe4r\n", (c) => c.charCodeAt(0));
const CORPUS = JSON.parse(readFileSync(path.join(HERE, "encoding-guard-corpus.json"), "utf8"));

/** node:fs stand-in for the mod's $.fs-backed io. */
const io = {
  /** @param {string} p */
  stat: async (p) => {
    const st = statSync(p);
    return { kind: st.isFile() ? "file" : "dir", size: st.size };
  },
  /** @param {string} p @param {number} size */
  sample: async (p, size) => {
    const buf = new Uint8Array(Math.min(size, SAMPLE_BYTES));
    const fd = openSync(p, "r");
    try {
      return buf.subarray(0, readSync(fd, buf, 0, buf.length, 0));
    } finally {
      closeSync(fd);
    }
  },
};

/** Fixtures as the bats suite built them with printf byte escapes. */
function fixtures() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ct-enc-"));
  /** @type {Record<string, number[] | string>} */
  const files = {
    "legacy.txt": [...LEGACY],
    "utf8.txt": "Täglich grüßt\n",
    "ascii.txt": "plain ascii\n",
    "utf8bom.txt": "﻿bom utf8\n",
    "utf16le.txt": [0xff, 0xfe, 0x68, 0, 0x69, 0, 0x0a, 0],
    "utf16-nobom.txt": [0x68, 0, 0x65, 0, 0x6c, 0, 0x6c, 0, 0x6f, 0, 0x0a, 0],
    "binary.png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52],
    "empty.txt": "",
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), typeof content === "string" ? content : new Uint8Array(content));
  }
  return dir;
}

/** @param {string} tool @param {string} filePath */
const fileCall = (tool, filePath) => collectOffenders({ tool, file_path: filePath }, "/", undefined, io);

test("allows UTF-8, ASCII, UTF-8-BOM, binary, empty and missing files", async () => {
  const dir = fixtures();
  for (const f of ["utf8.txt", "ascii.txt", "utf8bom.txt", "binary.png", "empty.txt", "missing.txt"]) {
    assert.deepEqual(await fileCall("Read", path.join(dir, f)), [], f);
  }
});

test("denies Read of a legacy single-byte file with an iconv hint", async () => {
  const dir = fixtures();
  const legacy = path.join(dir, "legacy.txt");
  const offenders = await fileCall("Read", legacy);
  assert.deepEqual(offenders, [{ path: legacy, label: "ISO-8859-1/Windows-1252 (legacy single-byte)", iconv: "WINDOWS-1252" }]);
  const reason = denyReason(offenders);
  assert.match(reason, /ISO-8859-1\/Windows-1252/);
  assert.ok(reason.includes(`iconv -f WINDOWS-1252 -t UTF-8 '${legacy}'`));
});

test("the deny reason text is unchanged from the command hook's", () => {
  assert.equal(
    denyReason([{ path: "/a", label: "UTF-16LE", iconv: "UTF-16LE" }]),
    "encoding-guard: /a (UTF-16LE) is not UTF-8. " +
      "Native Read/Edit/Write and plain shell text tools assume UTF-8 and would misread or corrupt the content. " +
      "Read safely with: iconv -f UTF-16LE -t UTF-8 '/a'. " +
      "To modify: convert to UTF-8, edit, convert back with iconv -f UTF-8 -t UTF-16LE — or use another encoding-preserving tool.",
  );
  assert.match(
    denyReason([
      { path: "/a", label: "x", iconv: "X" },
      { path: "/b", label: "y", iconv: "Y" },
    ]),
    /^encoding-guard: \/a \(x\), \/b \(y\) are not UTF-8\./,
  );
});

test("denies Edit and Write of a legacy file, allows Write to a new path", async () => {
  const dir = fixtures();
  assert.equal((await fileCall("Edit", path.join(dir, "legacy.txt"))).length, 1);
  assert.equal((await fileCall("Write", path.join(dir, "legacy.txt"))).length, 1);
  assert.deepEqual(await fileCall("Write", path.join(dir, "brand-new-file.txt")), []);
});

test("names UTF-16 with and without BOM", async () => {
  const dir = fixtures();
  assert.equal((await fileCall("Read", path.join(dir, "utf16le.txt")))[0].label, "UTF-16LE");
  assert.equal((await fileCall("Read", path.join(dir, "utf16-nobom.txt")))[0].label, "UTF-16LE (no BOM)");
});

test("fails open on unknown tools, missing arguments and a failing io", async () => {
  const dir = fixtures();
  const legacy = path.join(dir, "legacy.txt");
  assert.deepEqual(await fileCall("Glob", legacy), []);
  assert.deepEqual(await collectOffenders({ tool: "Read" }, "/", undefined, io), []);
  assert.deepEqual(await collectOffenders({ tool: "Bash", command: 42 }, "/", undefined, io), []);
  const broken = {
    stat: io.stat,
    sample: async () => {
      throw new Error("EACCES");
    },
  };
  assert.deepEqual(await collectOffenders({ tool: "Read", file_path: legacy }, "/", undefined, broken), []);
});

test("Bash corpus: every deny/allow case classifies as expected", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ct-corpus-"));
  writeFileSync(path.join(dir, "legacy.txt"), LEGACY);
  writeFileSync(path.join(dir, "utf8.txt"), "Täglich grüßt\n");
  const failures = [];
  for (const { cmd, expect } of CORPUS) {
    const denied = (await collectOffenders({ tool: "Bash", command: cmd }, dir, undefined, io)).length > 0;
    if (denied !== (expect === "deny")) failures.push(`[expected ${expect}] ${cmd}`);
  }
  assert.deepEqual(failures, []);
});

test("Bash names each offending file once, in command order", async () => {
  const dir = fixtures();
  const offenders = await collectOffenders({ tool: "Bash", command: "cat legacy.txt ./legacy.txt utf16le.txt" }, dir, undefined, io);
  assert.deepEqual(
    offenders.map((o) => path.basename(o.path)),
    ["legacy.txt", "utf16le.txt"],
  );
});

test("bashCandidates keeps only clean literal tokens", () => {
  assert.deepEqual(bashCandidates('cat a.txt "$(x)" $F -n b*.txt > out.txt'), ["out.txt", "a.txt"]);
  assert.deepEqual(bashCandidates("ls a.txt"), []);
});

test("classifyBytes: a multibyte sequence cut at a truncated sample's end is tolerated", () => {
  const cut = new Uint8Array([0x61, 0xc3]);
  assert.deepEqual(classifyBytes(cut, true), { safe: true });
  assert.equal(classifyBytes(cut, false).safe, false);
  assert.equal(classifyBytes(new Uint8Array([0xff, 0xfe, 0, 0]), false).safe, false); // UTF-32LE BOM
});

test("files over SAMPLE_BYTES are classified by their first 64 KiB", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ct-big-"));
  const big = path.join(dir, "big.txt");
  const bytes = new Uint8Array(SAMPLE_BYTES + 1).fill(0x61);
  bytes[SAMPLE_BYTES] = 0xe4;
  writeFileSync(big, bytes);
  assert.deepEqual(await fileCall("Read", big), []); // the legacy byte lies past the sample
});

test("resolvePath expands ~ and folds . and .. against cwd", () => {
  assert.equal(resolvePath("a/../b/./c.txt", "/w/x", undefined), "/w/x/b/c.txt");
  assert.equal(resolvePath("/abs/../p", "/w", undefined), "/p");
  assert.equal(resolvePath("~/f", "/w", "/home/u"), "/home/u/f");
  assert.equal(resolvePath("~/f", "/w", undefined), "/w/~/f");
  assert.equal(resolvePath("../../..", "/w", undefined), "/");
});

test("decodeBase64 round-trips bytes and tolerates line breaks", () => {
  assert.deepEqual([...decodeBase64("/+4A\nYQ==\n")], [0xff, 0xee, 0x00, 0x61]);
});
