#!/usr/bin/env node
// Stop hook: unconditionally refreshes this project's "dream due" flag.
// check-dream-due.mjs (SessionStart) is the sole gate on auto_dream + flag
// presence -- this script never reads user_config, so the flag always
// stays fresh regardless of the toggle.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/** @param {string} projectDir @returns {string} */
export function flagPathFor(projectDir) {
  const hash = createHash("sha256").update(path.resolve(projectDir)).digest("hex").slice(0, 8);
  const dataDir = process.env.CLAUDE_PLUGIN_DATA || ".";
  return path.resolve(dataDir, `dream-due-${hash}.flag`);
}

// True only when this file is the process entry point (Stop hook spawn),
// false when imported by a unit test -- so importing never touches the flag.
/** @returns {boolean} */
function isMainModule() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
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
    fs.mkdirSync(path.dirname(flagPath), { recursive: true });
    fs.closeSync(fs.openSync(flagPath, "a"));
  } catch {
    // fail open: never block Stop on a parse/filesystem hiccup
  }
  process.exit(0);
}

if (isMainModule()) main();
