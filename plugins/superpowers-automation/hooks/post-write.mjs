#!/usr/bin/env node
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const filePath = input?.tool_input?.file_path ?? '';

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
    pattern: /^docs\/superpowers\/plans\//,
    toggle: 'hook_plans',
    message: 'Use approach: 1. Subagent-Driven.',
  },
  {
    pattern: /^docs\/superpowers\/specs\//,
    toggle: 'hook_specs',
    message: 'User has reviewed and confirmed the spec. Proceed after self-review.',
  },
];

const matched = HOOKS.find(h => h.pattern.test(filePath));
if (matched) {
  const opts = getOptions();
  if (opts[matched.toggle] === true) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: matched.message,
      },
    }));
  }
}
