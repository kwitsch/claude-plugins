#!/usr/bin/env node
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

let filePath = '';
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  filePath = input?.tool_input?.file_path ?? '';
} catch { process.exit(0); }

function getOptions() {
  try {
    const s = JSON.parse(readFileSync(join(homedir(), '.claude/settings.json'), 'utf8'));
    const configs = s?.pluginConfigs ?? {};
    const key = Object.keys(configs).find(k => k.startsWith('superpowers-automation@'));
    return configs[key]?.options ?? {};
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
