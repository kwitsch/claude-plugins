#!/usr/bin/env node
// build.mjs — build driver for the universal-format MCP server. Spawns the local `bun build`,
// canonicalizes bun's provenance comments, prepends the 3-line banner (shebang + @ts-nocheck +
// build fingerprint) and writes the committed artifact at
// plugins/universal-format/mcp/server.mjs, mode 0755.
// Runs under plain `node` AND under `bun`. Requires a local `bun`; CI never runs this script —
// artifact freshness is a node-only assertion in test/universal-format/build-artifact.test.mjs.
// Run `pnpm install --frozen-lockfile` in this tree first: the bundle embeds that prettier, and
// bun's `// <path>` provenance comments are relative to the tree's own node_modules.
import process from "node:process";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SRC_DIR, "..", "..");
const OUT_FILE = path.join(REPO_ROOT, "plugins", "universal-format", "mcp", "server.mjs");

/** True when a local `bun` answers `bun --version`. @returns {boolean} */
function haveBun() {
  const probe = spawnSync("bun", ["--version"], { encoding: "utf8" });
  return !probe.error && probe.status === 0;
}

/** Every regular file under `dir`, recursively, as absolute paths. @param {string} dir @returns {string[]} */
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

/** First 16 hex chars of sha256 over every source file as `relpath \0 bytes \0`, sorted by
 * repo-relative POSIX path. build.mjs itself is included on purpose: a flag change here changes
 * the output. @param {string} dir @returns {string} */
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

/** Rewrite pnpm-store paths inside bun's `// `-prefixed provenance comments ONLY, so a hoisted
 * and a pnpm-symlinked node_modules produce identical output. Restricting the transform to
 * comment lines keeps it from ever touching bundled code or string literals.
 * @param {string} text @returns {string} */
function canonicalize(text) {
  return text
    .split("\n")
    .map((line) => (line.startsWith("// ") ? line.replace(/node_modules\/\.pnpm\/[^/]+\/node_modules\//g, "node_modules/") : line))
    .join("\n");
}

if (!haveBun()) {
  process.stderr.write("bun is required to build the universal-format MCP server. Install bun (https://bun.sh), then re-run `pnpm run build:universal-format-mcp`.\n");
  process.exit(1);
}

const tmpDir = mkdtempSync(path.join(tmpdir(), "uf-mcp-build-"));
const tmpOut = path.join(tmpDir, "server.mjs");
// cwd is pinned to the repo root: bun embeds cwd-relative `// <module path>` provenance
// comments, so building the same tree from a parent directory would change ~20 comment lines.
const built = spawnSync("bun", ["build", path.join(SRC_DIR, "server.ts"), "--target=node", "--format=esm", "--outfile=" + tmpOut], { cwd: REPO_ROOT, stdio: "inherit" });
if (built.error || built.status !== 0) {
  rmSync(tmpDir, { recursive: true, force: true });
  process.stderr.write("bun build failed; the committed artifact was left untouched.\n");
  process.exit(1);
}

const body = canonicalize(readFileSync(tmpOut, "utf8"));
rmSync(tmpDir, { recursive: true, force: true });

const srcHash = hashSourceTree(SRC_DIR);
const bodyHash = createHash("sha256").update(body).digest("hex").slice(0, 16);
const require = createRequire(import.meta.url);
const prettierVersion = JSON.parse(readFileSync(require.resolve("prettier/package.json"), "utf8")).version;
const bunVersion = String(spawnSync("bun", ["--version"], { encoding: "utf8" }).stdout ?? "").trim();

const banner = [
  "#!/usr/bin/env node",
  "// @ts-nocheck -- generated bundle; edit src/universal-format-mcp/*.ts, run `pnpm run build:universal-format-mcp`",
  `// uf-build-fingerprint src=${srcHash} body=${bodyHash} prettier=${prettierVersion} bun=${bunVersion}`,
  "",
].join("\n");

writeFileSync(OUT_FILE, banner + body);
chmodSync(OUT_FILE, 0o755);
process.stderr.write(`built ${path.relative(REPO_ROOT, OUT_FILE)} — src=${srcHash} body=${bodyHash} prettier=${prettierVersion} bun=${bunVersion}\n`);
