#!/usr/bin/env node
// .claude/hooks/lint-format.mjs — PostToolUse:Write|Edit hook.
// On .js/.mjs files: format with the project's local prettier silently, then
// surface the project's local eslint output as additionalContext. Uses the
// same node_modules binaries as `npm run lint`/`npm run format`, so it works
// for any contributor who has run `npm ci` — fails open (no-op) otherwise.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PROJECT_ROOT =
  process.env.CLAUDE_PROJECT_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRETTIER_BIN = path.join(
  PROJECT_ROOT,
  "node_modules",
  ".bin",
  "prettier",
);
const ESLINT_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "eslint");

/** @param {string} filePath @returns {boolean} */
export function shouldLint(filePath) {
  return /\.m?js$/.test(filePath);
}

/** @param {string} lintOutput @returns {HookResult | null} */
export function buildContext(lintOutput) {
  const trimmed = lintOutput.trim();
  if (!trimmed) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: trimmed,
    },
  };
}

function main() {
  let filePath;
  try {
    /** @type {ToolHookInput} */
    const input = JSON.parse(readFileSync(0, "utf8"));
    const fp = input.tool_input ? input.tool_input.file_path : undefined;
    filePath = typeof fp === "string" ? fp : "";
  } catch {
    return;
  }

  if (!shouldLint(filePath)) return;

  try {
    execFileSync(PRETTIER_BIN, ["--write", filePath], { stdio: "ignore" });
  } catch {
    /* best-effort formatting; a prettier failure must not block linting */
  }

  let lintOutput = "";
  try {
    execFileSync(ESLINT_BIN, [filePath], { encoding: "utf8" });
  } catch (e) {
    const err = /** @type {any} */ (e);
    lintOutput = String(err?.stdout ?? "");
  }

  const context = buildContext(lintOutput);
  if (context) console.log(JSON.stringify(context));
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
