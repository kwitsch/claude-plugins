/**
 * Shared helpers for the mcp_tool hook harness.
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const MOCK_SERVER = path.join(ROOT, 'mock-mcp-server', 'server.mjs');
export const RESULTS_DIR = path.join(ROOT, 'results');
export const RUN_DIR = path.join(RESULTS_DIR, 'runs');

export function mcpConfig(serverName = 'harness') {
  return {
    mcpServers: {
      [serverName]: { command: 'node', args: [MOCK_SERVER] },
    },
  };
}

export function settingsFor(scenario, marker, serverName = 'harness', timeout = 30) {
  const handler = {
    type: 'mcp_tool',
    server: serverName,
    tool: scenario.tool,
    input: { event: '${hook_event_name}', marker },
    timeout,
  };
  const group = {};
  // Only PreToolUse/PostToolUse accept a matcher; emitting one on other events
  // (e.g. SessionStart) is at best ignored and may prevent registration.
  const matcherEvent = scenario.event === 'PreToolUse' || scenario.event === 'PostToolUse';
  if (matcherEvent && scenario.matcher && scenario.matcher.length > 0) group.matcher = scenario.matcher;
  group.hooks = [handler];
  return { hooks: { [scenario.event]: [group] } };
}

export function makeMarker(scenarioId) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `HM_${scenarioId.toUpperCase()}_${rand}`;
}

async function walk(dir, sinceMs, acc) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(p, sinceMs, acc);
    } else if (e.isFile() && p.endsWith('.jsonl')) {
      try {
        const st = await fs.stat(p);
        if (st.mtimeMs >= sinceMs - 5000) acc.push(p);
      } catch {
        /* ignore */
      }
    }
  }
  return acc;
}

/**
 * Search Claude Code project transcripts (modified at/after sinceMs) for a token.
 * Returns { count, files: [{file, lines:[...]}] }.
 */
export async function grepTranscripts(token, sinceMs) {
  const base = path.join(os.homedir(), '.claude', 'projects');
  const files = await walk(base, sinceMs, []);
  const hits = [];
  let count = 0;
  for (const f of files) {
    let content;
    try {
      content = await fs.readFile(f, 'utf8');
    } catch {
      continue;
    }
    if (!content.includes(token)) continue;
    const lines = content
      .split('\n')
      .filter((l) => l.includes(token))
      .slice(0, 8);
    count += lines.length;
    hits.push({ file: f, lines });
  }
  return { count, files: hits };
}

export function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Classify a scenario result from collected evidence.
 * evidence: { ctxHits, reasonHits, result, fileExists }
 * Returns { verdict: 'PASS'|'FAIL'|'INCONCLUSIVE', note }
 */
export function classify(scenario, ev) {
  const ctx = ev.ctxHits?.count || 0;
  const reason = ev.reasonHits?.count || 0;
  const r = ev.result || {};
  const turns = typeof r.num_turns === 'number' ? r.num_turns : null;
  switch (scenario.detect) {
    case 'context_marker':
      return ctx > 0
        ? { verdict: 'PASS', note: `additionalContext marker present (${ctx} hit(s))` }
        : { verdict: 'FAIL', note: 'additionalContext marker not found in transcripts (dropped or hook did not fire)' };
    case 'marker_in_transcript':
      return reason > 0
        ? { verdict: 'PASS', note: `decision reason marker surfaced (${reason})` }
        : { verdict: 'FAIL', note: 'decision reason marker not found' };
    case 'deny_blocks_write':
      if (ev.fileExists === false && reason > 0)
        return { verdict: 'PASS', note: 'write blocked and deny reason surfaced' };
      if (ev.fileExists === false)
        return { verdict: 'PASS', note: 'write target absent (likely blocked); reason marker not confirmed' };
      return { verdict: 'FAIL', note: 'write target exists -> deny did not take effect' };
    case 'stop_blocked':
      if (turns !== null && turns > 1) return { verdict: 'PASS', note: `turn continued (num_turns=${turns})` };
      if (reason > 0) return { verdict: 'PASS', note: 'stop reason marker surfaced' };
      return { verdict: 'INCONCLUSIVE', note: `could not confirm continuation (num_turns=${turns})` };
    case 'stopped_with_marker':
      if (reason > 0) return { verdict: 'PASS', note: 'continue:false stopReason marker surfaced (coarse stop confirmed)' };
      return { verdict: 'INCONCLUSIVE', note: 'stopReason marker not found; inspect raw evidence' };
    case 'nonblocking_proceeds':
      if (ev.fileExists === true) return { verdict: 'PASS', note: 'tool proceeded despite isError (non-blocking confirmed)' };
      return { verdict: 'INCONCLUSIVE', note: 'probe file missing; inspect whether the model simply did not call Write' };
    default:
      return { verdict: 'INCONCLUSIVE', note: 'unknown detect type' };
  }
}

export { existsSync, fs, path, os };
