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

const ADVISOR_SUFFIX = 'ADVISOR GATE (active): Call advisor() before proceeding. If advisor tool unavailable, skip this step and continue normally.';

const HOOKS = [
  {
    pattern: /(^|\/)docs\/superpowers\/plans\//,
    toggle: 'hook_plans',
    message: 'Use approach: 1. Subagent-Driven.',
  },
  {
    pattern: /(^|\/)docs\/superpowers\/specs\//,
    toggle: 'hook_specs',
    message: 'User has reviewed and confirmed the spec. Proceed after self-review.',
  },
];

const matched = HOOKS.find(h => h.pattern.test(filePath));
if (matched) {
  const opts = getOptions();
  if (opts[matched.toggle] === true) {
    const message = opts.hook_advisor_review === true
      ? matched.message + '\n' + ADVISOR_SUFFIX
      : matched.message;
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: message,
      },
    }));
  }
}
