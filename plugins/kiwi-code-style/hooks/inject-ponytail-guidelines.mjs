#!/usr/bin/env node
// SessionStart hook: injects the karpathy-ponytail coding guidelines (full
// ladder, no lite/ultra) as additionalContext every session -- no matcher,
// see hooks.json's own description for why /clear and /compact need it too.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const GUIDELINES_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "ponytail-guidelines.md");

const HTML_COMMENT = /<!--[\s\S]*?-->\n?/g;

/** @param {string} raw @returns {string} */
export function stripHtmlComments(raw) {
  return raw.replace(HTML_COMMENT, "").replace(/^\n+/, "");
}

/** @param {string} guidelines @returns {HookResult} */
export function buildResult(guidelines) {
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: stripHtmlComments(guidelines),
    },
  };
}

/** @returns {void} */
function main() {
  try {
    const guidelines = fs.readFileSync(GUIDELINES_PATH, "utf8");
    process.stdout.write(JSON.stringify(buildResult(guidelines)));
  } catch {
    // fail open: never block SessionStart on a missing/unreadable bundle
  }
  process.exit(0);
}

function isMainModule() {
  try {
    // realpath, not a plain string compare: invoking via a symlink to this
    // file (a worktree, or a symlinked tmp/home component) would otherwise
    // make process.argv[1] !== fileURLToPath(import.meta.url), so main()
    // never runs and the fail-open design swallows it silently. Same fix as
    // memory-enhancement's flag-dream-due.mjs isMainModule().
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) main();
