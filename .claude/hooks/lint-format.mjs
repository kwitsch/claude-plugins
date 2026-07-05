#!/usr/bin/env node
// .claude/hooks/lint-format.mjs — PostToolUse:Write|Edit hook.
// On .js/.mjs files inside this project: format with prettier silently, then
// surface eslint findings as additionalContext. Uses the project's own
// prettier/eslint (same packages `npm run lint`/`npm run format` use) via
// their programmatic APIs — works for any contributor who has run `npm ci`,
// fails open (no-op) otherwise. Files outside the project root are ignored.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PROJECT_ROOT =
  process.env.CLAUDE_PROJECT_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @param {string} filePath @returns {boolean} */
export function shouldLint(filePath) {
  return /\.m?js$/.test(filePath);
}

/** @param {string} filePath @returns {boolean} */
export function isInProject(filePath) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  return (
    resolved === PROJECT_ROOT || resolved.startsWith(PROJECT_ROOT + path.sep)
  );
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

async function main() {
  let filePath;
  try {
    /** @type {ToolHookInput} */
    const input = JSON.parse(readFileSync(0, "utf8"));
    const fp = input.tool_input ? input.tool_input.file_path : undefined;
    filePath = typeof fp === "string" ? fp : "";
  } catch {
    return;
  }

  if (!shouldLint(filePath) || !isInProject(filePath)) return;

  try {
    const prettier = await import("prettier");
    const source = readFileSync(filePath, "utf8");
    const formatted = await prettier.format(source, { filepath: filePath });
    if (formatted !== source) writeFileSync(filePath, formatted);
  } catch {
    /* best-effort formatting; a prettier failure must not block linting */
  }

  let lintOutput = "";
  try {
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: PROJECT_ROOT });
    const results = await eslint.lintText(readFileSync(filePath, "utf8"), {
      filePath,
    });
    const formatter = await eslint.loadFormatter("stylish");
    lintOutput = String(await formatter.format(results));
  } catch {
    /* fail open: lint tool unavailable or misconfigured, no lint context */
  }

  const context = buildContext(lintOutput);
  if (context) console.log(JSON.stringify(context));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
