#!/usr/bin/env node
// Stop hook: unconditionally refreshes this project's "dream due" flag.
// check-dream-due.mjs (SessionStart) is the sole gate on auto_dream + flag
// presence -- this script never reads user_config, so the flag always
// stays fresh regardless of the toggle. Also the shared home for
// flagPathFor/isMainModule -- check-dream-due.mjs imports both instead of
// duplicating them.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/** @param {string} projectDir @returns {string} */
export function flagPathFor(projectDir) {
  // realpath, not a plain resolve: two symlink variants of the same project
  // dir (e.g. a worktree, or a symlinked tmp/home component) must hash to
  // the same flag path. Falls back to resolve() if the dir doesn't exist yet.
  let resolved;
  try {
    resolved = fs.realpathSync(projectDir);
  } catch {
    resolved = path.resolve(projectDir);
  }
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 8);
  const dataDir = process.env.CLAUDE_PLUGIN_DATA || ".";
  return path.resolve(dataDir, `dream-due-${hash}.flag`);
}

// True only when this file is the process entry point (hook spawn), false
// when imported by a unit test or by the sibling hook -- so importing never
// triggers the importer's main(). Callers pass their OWN import.meta.url
// (not this file's) so the entry-point check targets the right file.
/** @param {string} moduleUrl @returns {boolean} */
export function isMainModule(moduleUrl) {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/** @returns {void} */
function main() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    /** @type {StopHookInput} */
    const event = JSON.parse(raw);
    const projectDir = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
    const flagPath = flagPathFor(projectDir);
    if (!fs.existsSync(flagPath)) {
      fs.mkdirSync(path.dirname(flagPath), { recursive: true });
      fs.writeFileSync(flagPath, "");
    }
  } catch {
    // fail open: never block Stop on a parse/filesystem hiccup
  }
  process.exit(0);
}

if (isMainModule(import.meta.url)) main();
