#!/usr/bin/env node
// post-write.mjs — PostToolUse:Write hook for the superpowers-automation plugin.
// Fires after any Write tool call; inspects file_path against HOOKS patterns.
// When hook_plans is true and a plan file was written, emits hook JSON on stdout:
//   { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "..." } }
// Fails open (exits 0, no output) on parse errors or missing/toggled-off settings.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let filePath = '';
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  filePath = input?.tool_input?.file_path ?? '';
} catch { process.exit(0); }

// Read the superpowers-automation plugin options from ~/.claude/settings.json; returns {} on any error.
function getOptions() {
  try {
    const s = JSON.parse(readFileSync(join(homedir(), '.claude/settings.json'), 'utf8'));
    const configs = s?.pluginConfigs ?? {};
    const key = Object.keys(configs).find(k => k.startsWith('superpowers-automation@'));
    return key ? configs[key]?.options ?? {} : {};
  } catch { return {}; }
}

const HOOKS = [
  {
    pattern: /(^|\/)docs\/superpowers\/plans\//,
    toggle: 'hook_plans',
    next: 'superpowers:subagent-driven-development',
  },
];

const matched = HOOKS.find(h => h.pattern.test(filePath));
if (matched) {
  const opts = getOptions();
  if (opts[matched.toggle] === true) {
    const message =
      `A plan was written: ${filePath}. ` +
      `Implement it with the ${matched.next} skill task-by-task ` +
      `(do not ask which approach — use Subagent-Driven).`;
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: message,
      },
    }));
  }
}
