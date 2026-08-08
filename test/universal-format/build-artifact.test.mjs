import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUNDLED_PRETTIER_VERSION } from "../../plugins/universal-format/mcp/server.mjs";

// Plain node:test — no bun, no rebuild. Catches all three realistic staleness causes: sources
// edited without a rebuild (src= hash), the artifact hand-edited (body= hash), prettier bumped
// without a rebuild (prettier= / BUNDLED_PRETTIER_VERSION). Byte-equality across bun versions is
// deliberately NOT required.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = path.join(REPO_ROOT, "src", "universal-format-mcp");
const ARTIFACT = path.join(REPO_ROOT, "plugins", "universal-format", "mcp", "server.mjs");
const FINGERPRINT_RE = /^\/\/ uf-build-fingerprint src=([0-9a-f]{16}) body=([0-9a-f]{16}) prettier=(\S+) bun=(\S*)$/;

const text = readFileSync(ARTIFACT, "utf8");
const lines = text.split("\n");

/** @param {string} line @returns {{src: string, body: string, prettier: string}} */
function parseFingerprint(line) {
  const m = FINGERPRINT_RE.exec(line);
  if (!m) throw new Error(`line 3 is not a uf-build-fingerprint line: ${line}`);
  return { src: m[1], body: m[2], prettier: m[3] };
}

/** Every regular file under `dir`, recursively. @param {string} dir @returns {string[]} */
function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** build.mjs's exact source-hash algorithm, re-implemented so this gate needs no bun and no
 * import of the build script. @param {string} dir @returns {string} */
function hashSourceTree(dir) {
  const files = listFiles(dir)
    .map((full) => ({ rel: path.relative(REPO_ROOT, full).split(path.sep).join("/"), full }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.rel);
    hash.update("\0");
    hash.update(readFileSync(file.full));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

test("artifact banner: shebang, @ts-nocheck, parseable build fingerprint", () => {
  assert.equal(lines[0], "#!/usr/bin/env node");
  assert.ok(lines[1].includes("@ts-nocheck"), "line 2 must carry the @ts-nocheck generated-bundle banner");
  assert.match(lines[2], FINGERPRINT_RE);
});

test("artifact is current: src= matches src/universal-format-mcp/**", () => {
  assert.equal(parseFingerprint(lines[2]).src, hashSourceTree(SRC_DIR), "sources changed without a rebuild — run `pnpm run build:universal-format-mcp`");
});

test("artifact is intact: body= matches the bundle body", () => {
  const body = lines.slice(3).join("\n");
  assert.equal(parseFingerprint(lines[2]).body, createHash("sha256").update(body).digest("hex").slice(0, 16), "the artifact was hand-edited — edit src/universal-format-mcp/*.ts and rebuild");
});

test("bundled prettier matches the banner and the installed prettier", () => {
  const installed = JSON.parse(readFileSync(createRequire(import.meta.url).resolve("prettier/package.json"), "utf8")).version;
  assert.equal(BUNDLED_PRETTIER_VERSION, parseFingerprint(lines[2]).prettier, "banner prettier= must match the prettier baked into the bundle");
  assert.equal(BUNDLED_PRETTIER_VERSION, installed, "prettier was bumped without a rebuild — run `pnpm run build:universal-format-mcp`");
});
