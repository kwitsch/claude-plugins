#!/usr/bin/env node
// SessionStart hook: the sole gate for the auto-dream nudge. Reads the
// auto_dream userConfig value, interpolated by Claude Code into argv[2] (see
// hooks-json-authoring: "Plugin hooks/commands additionally substitute
// ${user_config.*}") -- fail-closed per plugin-userconfig's
// state-creating-toggle exception: only the literal string "true" enables.
// If enabled and this project's dream-due flag exists, injects a
// natural-language nudge and clears the flag (consumed once, so /clear and
// /compact don't re-fire it every time).
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

/** @param {string | undefined} value @returns {boolean} */
export function isAutoDreamEnabled(value) {
  return value === "true";
}

const NUDGE = "A memory dream cycle is due for this project. Run one now: "
  + "orient (locate the memory directory from this session's own auto-memory "
  + "system-prompt block), gather signal (targeted grep over the most recent "
  + "main-session transcripts for corrections/preferences/decisions), "
  + "consolidate (merge duplicate memories, drop stale entries, resolve "
  + "contradictions, back up each changed file alongside itself before "
  + "writing), then update the MEMORY.md index (keep it under 200 lines / "
  + "25KB). Only touch files that actually need a change.";

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
    /** @type {HookCommonInput} */
    const event = JSON.parse(raw);
    if (!isAutoDreamEnabled(process.argv[2])) {
      process.exit(0);
    }
    const projectDir = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
    const flagPath = flagPathFor(projectDir);
    if (!fs.existsSync(flagPath)) {
      process.exit(0);
    }
    fs.rmSync(flagPath, { force: true });
    /** @type {HookResult} */
    const result = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: NUDGE,
      },
    };
    process.stdout.write(JSON.stringify(result));
  } catch {
    // fail open: never block SessionStart on a parse/filesystem hiccup
  }
  process.exit(0);
}

if (isMainModule()) main();
