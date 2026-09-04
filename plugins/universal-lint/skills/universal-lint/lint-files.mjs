#!/usr/bin/env node
// universal-lint skill driver: run the plugin's own lint handler over a list of
// files and print one aggregated, read-only findings report. Reuses
// lintFileHandler from the hook verbatim — no new linting logic, no autofix.
// Reads a newline-delimited list file (argv[2]); each path is resolved against
// process.cwd(), which must contain the file (lintFileHandler hard-gates on
// containment and silently skips files outside it). lintFileHandler is
// synchronous (spawnSync internally) and bypasses main()'s 5s debounce (which
// lives only in main()/debounceGate, never the handler).
//
// ponytail: lintFileHandler reruns a whole-project `tsc --noEmit` per .ts file;
//   the incremental buildinfo cache keeps repeats cheap. Batch-per-tsconfig
//   dedup is a future optimization only if a large .ts batch ever bites.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lintFileHandler } from "../../hooks/lint-file.mjs";

const listFile = process.argv[2];
if (!listFile) {
  console.error("usage: lint-files.mjs <listfile>");
  process.exit(2);
}

// The repo's minimal ambient `process` type omits cwd(), and node:* imports are
// typed `any`; one cast keeps this file clean under checkJs+strict.
const cwd = /** @type {string} */ (/** @type {any} */ (process).cwd());
/** @type {string[]} */
const paths = String(readFileSync(listFile, "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

/** @param {string} resolved @returns {PostToolUseHookInput} */
function mkArgs(resolved) {
  return {
    session_id: "universal-lint-skill",
    transcript_path: "/dev/null",
    cwd,
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: resolved },
    tool_response: { success: true },
  };
}

/** @type {string[]} */
const blocks = [];
for (const p of paths) {
  const resolved = resolve(cwd, p);
  try {
    const result = lintFileHandler(mkArgs(resolved));
    const ctx = result?.hookSpecificOutput?.additionalContext;
    if (typeof ctx === "string" && ctx.length > 0) blocks.push(ctx);
  } catch {
    // fail open per file, matching the hook
  }
}

if (blocks.length === 0) {
  console.log("universal-lint: no findings.");
} else {
  console.log(blocks.join("\n\n"));
  console.log(`\nuniversal-lint: ${blocks.length} file(s) with findings.`);
}
process.exit(0);
