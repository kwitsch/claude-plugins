#!/usr/bin/env node
/**
 * run-matrix.mjs — drive the mcp_tool hook scenarios through `claude -p` and
 * report which decisions take effect on which event.
 *
 * Usage:
 *   node scripts/run-matrix.mjs [--dry-run] [--only id1,id2] [--include-semi]
 *
 * Env:
 *   CLAUDE_BIN          path to the claude binary (default: "claude")
 *   CLAUDE_PERM_MODE    permission mode (default: "acceptEdits")
 *   CLAUDE_MAX_TURNS    max turns per run (default: "4")
 *   CLAUDE_EXTRA_FLAGS  extra space-separated flags appended to every invocation
 *
 * NOTE ON FLAGS: this targets the documented `claude -p` interface
 * (--output-format json, --mcp-config, --settings, --max-turns, --permission-mode).
 * Flag names occasionally change between Claude Code versions; if a run fails to
 * start, check `claude -p --help` and set CLAUDE_EXTRA_FLAGS / edit buildArgs().
 */
import { spawn } from 'node:child_process';
import {
  ROOT, MOCK_SERVER, RESULTS_DIR, RUN_DIR, mcpConfig, settingsFor, makeMarker,
  grepTranscripts, classify, safeJson, fs, path, existsSync,
} from './lib.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const INCLUDE_SEMI = args.includes('--include-semi');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 && args[onlyIdx + 1] ? args[onlyIdx + 1].split(',') : null;

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const PERM_MODE = process.env.CLAUDE_PERM_MODE || 'acceptEdits';
const MAX_TURNS = process.env.CLAUDE_MAX_TURNS || '4';
const EXTRA = (process.env.CLAUDE_EXTRA_FLAGS || '').split(' ').filter(Boolean);

function buildArgs(prompt, mcpPath, settingsPath) {
  return [
    '-p', prompt,
    '--output-format', 'json',
    '--mcp-config', mcpPath,
    '--settings', settingsPath,
    '--permission-mode', PERM_MODE,
    '--max-turns', MAX_TURNS,
    ...EXTRA,
  ];
}

function run(cmd, argv, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd, env: process.env });
    let out = '';
    let err = '';
    const killer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(killer);
      resolve({ code: -1, out, err: String(e), spawnError: true });
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({ code, out, err, spawnError: false });
    });
  });
}

async function ensureDirs() {
  await fs.mkdir(RUN_DIR, { recursive: true });
}

async function main() {
  const specRaw = await fs.readFile(path.join(ROOT, 'config', 'scenarios.json'), 'utf8');
  const spec = JSON.parse(specRaw);
  await ensureDirs();

  let scenarios = spec.scenarios;
  if (ONLY) scenarios = scenarios.filter((s) => ONLY.includes(s.id));
  if (!INCLUDE_SEMI) scenarios = scenarios.filter((s) => s.trigger === 'auto');

  const mcpPath = path.join(RUN_DIR, 'mcp.json');
  await fs.writeFile(mcpPath, JSON.stringify(mcpConfig(spec.server_name), null, 2));

  // sanity: mock server present
  if (!existsSync(MOCK_SERVER)) {
    console.error(`Mock server not found at ${MOCK_SERVER}`);
    process.exit(2);
  }

  const haveClaude = DRY ? true : await checkClaude();
  const results = [];

  for (const sc of scenarios) {
    const marker = makeMarker(sc.id);
    const settings = settingsFor(sc, marker, spec.server_name);
    const settingsPath = path.join(RUN_DIR, `settings.${sc.id}.json`);
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    const argv = buildArgs(sc.prompt, mcpPath, settingsPath);
    const rec = {
      id: sc.id, event: sc.event, mode: sc.mode, marker,
      validates: sc.validates, settings_file: settingsPath,
      command: `${CLAUDE_BIN} ${argv.map(quote).join(' ')}`,
    };

    if (DRY || !haveClaude) {
      rec.verdict = 'NOT_RUN';
      rec.note = DRY ? 'dry-run: settings + command generated only' : 'claude binary not found (set CLAUDE_BIN)';
      results.push(rec);
      console.log(`[${rec.verdict}] ${sc.id} -> ${rec.command}`);
      continue;
    }

    const writeTarget = path.join(ROOT, spec.write_target_relpath);
    await fs.rm(path.dirname(writeTarget), { recursive: true, force: true }).catch(() => {});

    const startMs = Date.now();
    const res = await run(CLAUDE_BIN, argv, ROOT);
    const result = safeJson(res.out.trim().split('\n').filter(Boolean).pop() || '') || {};

    const ctxHits = await grepTranscripts(`HARNESS_CTX_${marker}`, startMs);
    const reasonHits = await grepTranscripts(`harness:${marker}`, startMs);
    const fileExists = sc.detect === 'deny_blocks_write' || sc.detect === 'nonblocking_proceeds'
      ? await anyProbeExists(ROOT)
      : null;

    const ev = { ctxHits, reasonHits, result, fileExists };
    const verdict = classify(sc, ev);
    Object.assign(rec, {
      verdict: verdict.verdict,
      note: verdict.note,
      exit_code: res.code,
      spawn_error: res.spawnError || undefined,
      result_subtype: result.subtype,
      result_is_error: result.is_error,
      num_turns: result.num_turns,
      ctx_hits: ctxHits.count,
      reason_hits: reasonHits.count,
      file_exists: fileExists,
      stderr_tail: (res.err || '').split('\n').slice(-4).join('\n'),
    });
    results.push(rec);
    console.log(`[${rec.verdict}] ${sc.id} (${sc.event}/${sc.mode}) :: ${rec.note}`);
  }

  const report = {
    generated_at: new Date().toISOString(),
    claude_bin: CLAUDE_BIN,
    permission_mode: PERM_MODE,
    max_turns: MAX_TURNS,
    dry_run: DRY,
    claude_found: haveClaude,
    results,
  };
  await fs.writeFile(path.join(RESULTS_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(RESULTS_DIR, 'report.md'), renderMd(report));
  console.log(`\nReport: ${path.join(RESULTS_DIR, 'report.json')}`);
}

function quote(s) {
  return /[\s"']/.test(s) ? JSON.stringify(s) : s;
}

async function anyProbeExists(root) {
  const dir = path.join(root, 'harness-scratch');
  try {
    const files = await fs.readdir(dir);
    return files.length > 0;
  } catch {
    return false;
  }
}

async function checkClaude() {
  const res = await run(CLAUDE_BIN, ['--version'], ROOT);
  if (res.spawnError) {
    console.error(`\n!! ${CLAUDE_BIN} not runnable. Install Claude Code or set CLAUDE_BIN. Falling back to NOT_RUN.\n`);
    return false;
  }
  return true;
}

function renderMd(report) {
  const head = `# mcp_tool hook harness — report\n\n` +
    `- generated_at: ${report.generated_at}\n` +
    `- claude_bin: \`${report.claude_bin}\` | permission_mode: \`${report.permission_mode}\` | max_turns: ${report.max_turns}\n` +
    `- dry_run: ${report.dry_run} | claude_found: ${report.claude_found}\n\n` +
    `| id | event | mode | verdict | ctx | reason | turns | note |\n` +
    `|---|---|---|---|---|---|---|---|\n`;
  const rows = report.results
    .map((r) => `| ${r.id} | ${r.event} | ${r.mode} | ${r.verdict} | ${r.ctx_hits ?? '-'} | ${r.reason_hits ?? '-'} | ${r.num_turns ?? '-'} | ${(r.note || '').replace(/\|/g, '/')} |`)
    .join('\n');
  return head + rows + '\n';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
