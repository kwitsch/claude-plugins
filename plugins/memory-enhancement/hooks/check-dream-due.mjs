#!/usr/bin/env node
// SessionStart hook: the sole gate for the auto-dream nudge. Reads the
// auto_dream userConfig value, interpolated by Claude Code into argv[2] (see
// hooks-json-authoring: "Plugin hooks/commands additionally substitute
// ${user_config.*}") -- fail-open: only the literal string "false" disables
// (the hook itself creates no files/state, it only suggests one via
// additionalContext; the plugin-userconfig fail-closed exception is for
// toggles whose enabled state itself creates state, which this is not --
// same reasoning as universal-format's auto_format). If enabled and this
// project's dream-due flag exists, injects a natural-language nudge and
// clears the flag (consumed once, so /clear and /compact don't re-fire it
// every time).
import fs from "node:fs";
import process from "node:process";
import { flagPathFor, isMainModule } from "./flag-dream-due.mjs";

/** @param {string | undefined} value @returns {boolean} */
export function isAutoDreamEnabled(value) {
  return value !== "false";
}

const NUDGE = "A memory dream cycle is due for this project. Run one now: "
  + "orient (locate the memory directory from this session's own auto-memory "
  + "system-prompt block), gather signal (targeted grep over the most recent "
  + "main-session transcripts for corrections/preferences/decisions), "
  + "consolidate (merge duplicate memories, drop stale entries, resolve "
  + "contradictions, author a new memory file for any signal with no "
  + "existing memory home, back up each changed file alongside itself "
  + "before writing, compress new/changed files via cc-compress when "
  + "available), then update the MEMORY.md index (keep it under 200 lines "
  + "/ 25KB). Only touch files that actually need a change.";

/** @returns {void} */
function main() {
  if (!isAutoDreamEnabled(process.argv[2])) {
    process.exit(0);
  }
  try {
    const raw = fs.readFileSync(0, "utf8");
    /** @type {HookCommonInput} */
    const event = JSON.parse(raw);
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

if (isMainModule(import.meta.url)) main();
