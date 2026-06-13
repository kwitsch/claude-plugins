#!/usr/bin/env node
/**
 * generate-settings.mjs — emit a ready-to-use settings.json + mcp.json for ONE
 * scenario id, including manual-trigger events (Elicitation, WorktreeCreate,
 * SubagentStop, PreCompact, ...) that run-matrix does not auto-drive.
 *
 * Usage:
 *   node scripts/generate-settings.mjs <scenario-id> [marker]
 *
 * Output goes to results/manual/. Then run, e.g.:
 *   claude --mcp-config results/manual/mcp.json --settings results/manual/settings.<id>.json
 * and trigger the event manually (see README "Manual events").
 */
import { ROOT, RESULTS_DIR, mcpConfig, settingsFor, makeMarker, fs, path } from './lib.mjs';

const id = process.argv[2];
const markerArg = process.argv[3];
if (!id) {
  console.error('usage: node scripts/generate-settings.mjs <scenario-id> [marker]');
  process.exit(2);
}

const spec = JSON.parse(await fs.readFile(path.join(ROOT, 'config', 'scenarios.json'), 'utf8'));
const sc = spec.scenarios.find((s) => s.id === id);
if (!sc) {
  console.error(`unknown scenario id: ${id}`);
  console.error('available: ' + spec.scenarios.map((s) => s.id).join(', '));
  process.exit(2);
}

const marker = markerArg || makeMarker(sc.id);
const outDir = path.join(RESULTS_DIR, 'manual');
await fs.mkdir(outDir, { recursive: true });

const mcpPath = path.join(outDir, 'mcp.json');
const settingsPath = path.join(outDir, `settings.${sc.id}.json`);
await fs.writeFile(mcpPath, JSON.stringify(mcpConfig(spec.server_name), null, 2));
await fs.writeFile(settingsPath, JSON.stringify(settingsFor(sc, marker, spec.server_name), null, 2));

console.log(JSON.stringify({
  scenario: sc.id, event: sc.event, mode: sc.mode, marker,
  mcp_config: mcpPath, settings: settingsPath,
  trigger_hint: sc.prompt, validates: sc.validates,
  grep_for: sc.detect === 'context_marker' ? `HARNESS_CTX_${marker}` : `harness:${marker}`,
}, null, 2));
