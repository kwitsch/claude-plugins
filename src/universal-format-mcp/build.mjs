#!/usr/bin/env node
// build.mjs — build driver for the universal-format MCP server. Spawns the local `bun build`,
// canonicalizes bun's provenance comments, prepends the 3-line banner (shebang + @ts-nocheck +
// build fingerprint) and writes the committed artifact at
// plugins/universal-format/mcp/server.mjs, mode 0755. It also copies the bundled prettier
// plugins' .wasm sidecars next to that bundle (mode 0644) -- bun cannot see their runtime
// `new URL(name, import.meta.url)` lookups -- sweeping stale ones and hashing the survivors into
// the banner's assets= field.
// Runs under plain `node` AND under `bun`. Requires a local `bun`; CI never runs this script —
// artifact freshness is a node-only assertion in test/universal-format/build-artifact.test.mjs.
// Run `pnpm install --frozen-lockfile` in this tree first: the bundle embeds that prettier, and
// bun's `// <path>` provenance comments are relative to the tree's own node_modules.
import process from "node:process";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SRC_DIR, "..", "..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugins", "universal-format");
const OUT_FILE = path.join(PLUGIN_DIR, "mcp", "server.mjs");

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

// bun's CJS interop shim for sh-syntax/lib/index.js hardcodes the BUILD MACHINE's absolute
// node_modules path as a `var __dirname = "…"` literal, ahead of the shim's own
// import.meta.url-based fallback for when __dirname is undefined. That literal makes the
// committed artifact resolve sh-syntax's main.wasm against a path that only exists on the
// machine (and worktree) that ran the build. Reusing the shim's own fallback keeps the artifact
// self-contained; anchoring it one directory ("lib") deeper than the bundle's own directory
// preserves sh-syntax's `path.resolve(__dirname, "../main.wasm")` lookup landing next to the
// bundle, exactly where the other wasm sidecars are copied.
const SH_SYNTAX_DIRNAME_RE =
  /(\/\/ node_modules\/sh-syntax\/lib\/index\.js\nvar __dirname = )"[^"]*"(;\nvar _dirname = typeof __dirname === "undefined" \? (\w+)\.dirname\((\w+)\(import\.meta\.url\)\) : __dirname;)/;

/** Replace the hardcoded absolute path bun emits for sh-syntax's `__dirname` with an expression
 * built from the SAME import.meta.url fallback the next line already uses — reusing whatever
 * `path`/`fileURLToPath` local aliases bun picked this build, so nothing here depends on bun's
 * bundler-internal naming staying stable across builds. Throws if the known pattern is absent
 * (a sh-syntax/bun upgrade changed the shim shape): silently shipping the old absolute path back
 * is worse than a loud build failure. @param {string} text @returns {string} */
function containShSyntaxDirname(text) {
  if (!SH_SYNTAX_DIRNAME_RE.test(text)) {
    throw new Error("build.mjs: sh-syntax's `var __dirname = \"…\";` shim line was not found — sh-syntax or bun's CJS interop shim changed shape; update SH_SYNTAX_DIRNAME_RE.");
  }
  return text.replace(SH_SYNTAX_DIRNAME_RE, (_m, prefix, suffix, pathAlias, urlToPathAlias) => {
    const dirnameExpr = `${pathAlias}.join(${pathAlias}.dirname(${urlToPathAlias}(import.meta.url)), "lib")`;
    return `${prefix}${dirnameExpr}${suffix}`;
  });
}

if (!haveBun()) {
  process.stderr.write("bun is required to build the universal-format MCP server. Install bun (https://bun.sh), then re-run `pnpm run build:universal-format-mcp`.\n");
  process.exit(1);
}

// plugin.json is the single source of truth for the server's reported version -- inlined into
// the bundle via bun's --env (a compile-time constant substitution, verified empirically: the
// resulting literal survives running the built artifact under plain node with the env var unset),
// so SERVER_INFO.version in server.ts never needs hand-pairing with a release bump.
const pluginVersion = JSON.parse(readFileSync(path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), "utf8")).version;

const tmpDir = mkdtempSync(path.join(tmpdir(), "uf-mcp-build-"));
const tmpOut = path.join(tmpDir, "server.mjs");
// cwd is pinned to the repo root: bun embeds cwd-relative `// <module path>` provenance
// comments, so building the same tree from a parent directory would change ~20 comment lines.
const built = spawnSync("bun", ["build", path.join(SRC_DIR, "server.ts"), "--target=node", "--format=esm", "--env=UNIVERSAL_FORMAT_MCP_VERSION*", "--outfile=" + tmpOut], {
  cwd: REPO_ROOT,
  stdio: "inherit",
  env: { ...process.env, UNIVERSAL_FORMAT_MCP_VERSION: pluginVersion },
});
if (built.error || built.status !== 0) {
  rmSync(tmpDir, { recursive: true, force: true });
  process.stderr.write("bun build failed; the committed artifact was left untouched.\n");
  process.exit(1);
}

const body = containShSyntaxDirname(canonicalize(readFileSync(tmpOut, "utf8")));
rmSync(tmpDir, { recursive: true, force: true });

const srcHash = hashSourceTree(SRC_DIR);
const bodyHash = createHash("sha256").update(body).digest("hex").slice(0, 16);
const require = createRequire(import.meta.url);
const prettierVersion = JSON.parse(readFileSync(require.resolve("prettier/package.json"), "utf8")).version;
const bunVersion = String(spawnSync("bun", ["--version"], { encoding: "utf8" }).stdout ?? "").trim();

// The third-party prettier plugins bundled alongside prettier itself. Versions come from the
// DECLARED pins in the root package.json, not from node_modules: the pins are exact,
// `pnpm install --frozen-lockfile` guarantees declared == installed, and two of the three
// packages do not export "./package.json" at all (ERR_PACKAGE_PATH_NOT_EXPORTED).
const PLUGIN_PINS = ["prettier-plugin-java", "@prettier/plugin-php", "prettier-plugin-sh"];
const rootPkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
const pluginVersions = PLUGIN_PINS.map((name) => `${name}@${rootPkg.devDependencies[name]}`).join("+");

// bun build CANNOT emit these: all three are runtime lookups (`new URL`/CJS-`__dirname`-relative
// lookups against import.meta.url), invisible to the bundler -- verified that --outdir +
// --loader:.wasm=file emits only the JS. So copy them by hand, next to the bundle, because that
// is exactly where those lookups resolve once everything is one file (main.wasm's own lookup is
// contained to the same directory by containShSyntaxDirname above). web-tree-sitter and
// tree-sitter-java_orchard are resolved FROM prettier-plugin-java, the same way that plugin
// resolves them at runtime: web-tree-sitter is its transitive dependency, not a root one, so
// under pnpm's isolated node_modules it is reachable only from the plugin's own directory.
const javaPluginEntry = require.resolve("prettier-plugin-java");
const WASM_ASSETS = [
  // web-tree-sitter exports this subpath explicitly.
  createRequire(javaPluginEntry).resolve("web-tree-sitter/web-tree-sitter.wasm"),
  // prettier-plugin-java does NOT export the subpath (ERR_PACKAGE_PATH_NOT_EXPORTED), nor its
  // package.json. Resolve the entry and join -- mirrors the plugin's own runtime lookup.
  path.join(path.dirname(javaPluginEntry), "tree-sitter-java_orchard.wasm"),
  // sh-syntax exports this subpath explicitly, unlike the java plugin above.
  createRequire(require.resolve("prettier-plugin-sh")).resolve("sh-syntax/main.wasm"),
];

// Sweep every pre-existing *.wasm first: a plugin bump that renames its grammar must never leave
// an orphaned sidecar behind that build-artifact.test.mjs would still hash as present.
const OUT_DIR = path.dirname(OUT_FILE);
for (const name of readdirSync(OUT_DIR)) {
  if (name.endsWith(".wasm")) rmSync(path.join(OUT_DIR, name), { force: true });
}

// Same same-directory temp file + atomic rename the artifact itself uses; mode 0644 (data, not
// executable).
/** @type {Array<{base: string, bytes: Buffer}>} */
const assets = [];
for (const asset of WASM_ASSETS) {
  const base = path.basename(asset);
  const bytes = readFileSync(asset);
  const tmpAsset = path.join(OUT_DIR, `.${base}.tmp-${process.pid}`);
  writeFileSync(tmpAsset, bytes);
  chmodSync(tmpAsset, 0o644);
  renameSync(tmpAsset, path.join(OUT_DIR, base));
  assets.push({ base, bytes });
}

// hashSourceTree covers only src/, so a deleted, stale or corrupted sidecar would change neither
// src= nor body=. Same `name \0 bytes \0` shape, keyed by basename, sorted by basename.
assets.sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : 0));
const assetsDigest = createHash("sha256");
for (const asset of assets) {
  assetsDigest.update(asset.base);
  assetsDigest.update("\0");
  assetsDigest.update(asset.bytes);
  assetsDigest.update("\0");
}
const assetsHash = assetsDigest.digest("hex").slice(0, 16);

const banner = [
  "#!/usr/bin/env node",
  "// @ts-nocheck -- generated bundle; edit src/universal-format-mcp/*.ts, run `pnpm run build:universal-format-mcp`",
  `// uf-build-fingerprint src=${srcHash} body=${bodyHash} prettier=${prettierVersion} plugins=${pluginVersions} assets=${assetsHash} bun=${bunVersion}`,
  "",
].join("\n");

// Write to a same-directory temp file, chmod it, then rename over OUT_FILE — the rename is
// atomic (same filesystem), so a crash/kill mid-write never leaves the committed artifact
// truncated or half-written.
const tmpArtifact = path.join(path.dirname(OUT_FILE), `.server.mjs.tmp-${process.pid}`);
writeFileSync(tmpArtifact, banner + body);
chmodSync(tmpArtifact, 0o755);
renameSync(tmpArtifact, OUT_FILE);
process.stderr.write(`built ${path.relative(REPO_ROOT, OUT_FILE)} — src=${srcHash} body=${bodyHash} prettier=${prettierVersion} plugins=${pluginVersions} assets=${assetsHash} bun=${bunVersion}\n`);
process.stderr.write(`copied ${assets.length} wasm sidecar(s) into ${path.relative(REPO_ROOT, OUT_DIR)}: ${assets.map((a) => a.base).join(", ")}\n`);
