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
const MCP_DIR = path.dirname(ARTIFACT);
// Sorted by basename, exactly as build.mjs hashes them.
const EXPECTED_WASM = ["main.wasm", "tree-sitter-java_orchard.wasm", "web-tree-sitter.wasm"];
// Same order build.mjs joins them in, so the expected `plugins=` string is reproducible here.
const PLUGIN_PINS = ["prettier-plugin-java", "@prettier/plugin-php", "prettier-plugin-sh"];
const FINGERPRINT_RE = /^\/\/ uf-build-fingerprint src=([0-9a-f]{16}) body=([0-9a-f]{16}) prettier=(\S+) plugins=(\S+) assets=([0-9a-f]{16}) bun=(\S*)$/;

const text = readFileSync(ARTIFACT, "utf8");
const lines = text.split("\n");

/** @param {string} line @returns {{src: string, body: string, prettier: string, plugins: string, assets: string}} */
function parseFingerprint(line) {
  const m = FINGERPRINT_RE.exec(line);
  if (!m) throw new Error(`line 3 is not a uf-build-fingerprint line: ${line}`);
  return { src: m[1], body: m[2], prettier: m[3], plugins: m[4], assets: m[5] };
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

test("banner plugins= matches the root package.json pins, and all three pins are exact", () => {
  const rootPkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const expected = PLUGIN_PINS.map((name) => `${name}@${rootPkg.devDependencies[name]}`).join("+");
  assert.equal(parseFingerprint(lines[2]).plugins, expected, "a plugin pin changed without a rebuild — run `pnpm run build:universal-format-mcp`");
  for (const name of PLUGIN_PINS) {
    assert.match(rootPkg.devDependencies[name], /^\d+\.\d+\.\d+$/, `${name} must be pinned exactly (no ^, ~ or range)`);
  }
});

// src=/body= cover only src/ and the bundle body, so a deleted, stale, corrupted or orphaned
// sidecar is invisible to them. assets= is the only gate on the shipped wasm files.
test("exactly the three expected .wasm sidecars ship next to the bundle, and assets= matches them", () => {
  // Cast: this repo ships no @types/node, so readdirSync's return is `any` and the filter
  // callback's parameter would be an implicit-any typecheck error.
  const found = /** @type {string[]} */ (readdirSync(MCP_DIR)).filter((name) => name.endsWith(".wasm")).sort();
  assert.deepEqual(found, EXPECTED_WASM, "mcp/ must hold exactly the three expected wasm sidecars (an orphan means a plugin bump renamed one)");
  const hash = createHash("sha256");
  for (const base of found) {
    hash.update(base);
    hash.update("\0");
    hash.update(readFileSync(path.join(MCP_DIR, base)));
    hash.update("\0");
  }
  assert.equal(parseFingerprint(lines[2]).assets, hash.digest("hex").slice(0, 16), "a sidecar is stale or corrupted — run `pnpm run build:universal-format-mcp`");
});

// bun's CJS interop shim for sh-syntax used to hardcode the BUILD MACHINE's absolute
// node_modules path as sh-syntax's `__dirname`, so the committed artifact only worked from the
// exact worktree that ran the build. Regression anchor: the artifact must be portable.
test("artifact is portable: no build-machine absolute path is embedded in the bundle", () => {
  assert.ok(!text.includes(REPO_ROOT), "the bundle embeds this checkout's own absolute path — a bundler CJS-interop shim likely hardcoded a build-machine __dirname again");
});

// The --target=node bundle must carry no Bun-only API: zero `Bun.` property accesses and zero
// `bun:` import specifiers. Converts the previously prose-only invariant into an enforced one.
// A benign vendored `process.versions.bun` read, plus the source's own detectRuntime copy, are
// fine — neither matches `/\bBun\./` — so the exact count is deliberately NOT asserted.
test("artifact uses no Bun-only API: no `Bun.` token and no `bun:` import", () => {
  assert.ok(!/\bBun\./.test(text), "the bundle references a `Bun.` API — the --target=node no-Bun invariant is broken; rebuild from Bun-API-free source");
  assert.ok(!/["']bun:/.test(text), "the bundle imports a `bun:` module — the --target=node no-Bun invariant is broken; rebuild from Bun-API-free source");
});
