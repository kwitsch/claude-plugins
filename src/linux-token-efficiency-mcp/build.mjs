#!/usr/bin/env node
// build.mjs — build driver for the linux-token-efficiency Rust MCP server. Runs
// `cargo build --release --target x86_64-unknown-linux-gnu`, then atomically (same-dir
// tmpfile + rename) copies the ELF over the committed artifact at
// plugins/linux-token-efficiency/mcp/linux-token-efficiency-mcp and chmod 0755.
// Requires a local cargo; CI never runs this. plugin.json is the single source of the
// embedded --version string (passed via LTE_MCP_VERSION at compile time).
import process from "node:process";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, readFileSync, renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SRC_DIR, "..", "..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugins", "linux-token-efficiency");
const OUT_FILE = path.join(PLUGIN_DIR, "mcp", "linux-token-efficiency-mcp");
const TARGET = "x86_64-unknown-linux-gnu";

const have = spawnSync("cargo", ["--version"], { encoding: "utf8" });
if (have.error || have.status !== 0) {
  process.stderr.write("cargo is required to build the linux-token-efficiency MCP server. Install Rust (https://rustup.rs), then re-run `pnpm run build:linux-token-efficiency-mcp`.\n");
  process.exit(1);
}

const pluginVersion = JSON.parse(readFileSync(path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), "utf8")).version;

const built = spawnSync("cargo", ["build", "--release", "--target", TARGET, "--manifest-path", path.join(SRC_DIR, "Cargo.toml")], {
  cwd: SRC_DIR,
  stdio: "inherit",
  env: { ...process.env, LTE_MCP_VERSION: pluginVersion },
});
if (built.error || built.status !== 0) {
  process.stderr.write("cargo build failed; the committed artifact was left untouched.\n");
  process.exit(1);
}

const compiled = path.join(SRC_DIR, "target", TARGET, "release", "linux-token-efficiency-mcp");
const tmp = path.join(path.dirname(OUT_FILE), `.linux-token-efficiency-mcp.tmp-${process.pid}`);
copyFileSync(compiled, tmp);
chmodSync(tmp, 0o755);
renameSync(tmp, OUT_FILE);
rmSync(tmp, { force: true });
process.stderr.write(`built ${path.relative(REPO_ROOT, OUT_FILE)} — version ${pluginVersion}\n`);
