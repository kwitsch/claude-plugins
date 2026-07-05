#!/usr/bin/env node
// .claude/hooks/lint-format.mjs — PostToolUse:Write|Edit hook.
// On .js/.mjs files: `rtk prettier --write` silently, then surface `rtk lint`
// output as additionalContext. No-ops (fails open) if `rtk` isn't on PATH.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** @param {string} filePath @returns {boolean} */
export function shouldLint(filePath) {
  return /\.m?js$/.test(filePath);
}

/** @returns {boolean} */
export function hasRtk() {
  try {
    execFileSync('command', ['-v', 'rtk'], { shell: '/bin/bash' });
    return true;
  } catch {
    return false;
  }
}

/** @param {string} lintOutput @returns {HookResult | null} */
export function buildContext(lintOutput) {
  const trimmed = lintOutput.trim();
  if (!trimmed) return null;
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: trimmed } };
}

function main() {
  let filePath = '';
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    filePath = input?.tool_input?.file_path ?? '';
  } catch {
    return;
  }

  if (!shouldLint(filePath) || !hasRtk()) return;

  try {
    execFileSync('rtk', ['prettier', '--write', filePath], { stdio: 'ignore' });
  } catch {
    /* best-effort formatting; a prettier failure must not block linting */
  }

  let lintOutput = '';
  try {
    execFileSync('rtk', ['lint', filePath], { encoding: 'utf8' });
  } catch (e) {
    const err = /** @type {any} */ (e);
    lintOutput = String(err?.stdout ?? '');
  }

  const context = buildContext(lintOutput);
  if (context) console.log(JSON.stringify(context));
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
