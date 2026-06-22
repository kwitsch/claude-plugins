import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CLAUDE_PLUGIN_DATA = mkdtempSync(join(tmpdir(), 'shelllspgate-'));
process.env.SHELL_LSP_ENFORCE_SEARCH = 'true';
process.env.SHELL_LSP_ENFORCE_READ_GATE = 'true';
const H = await import('../../plugins/shell-lsp/mcp/handlers.mjs');
const { resetState, readState } = await import('../../plugins/shell-lsp/mcp/state.mjs');

const CWD = '/proj';
const read = (fp) => ({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: fp }, cwd: CWD });
const lsp = () => ({ hook_event_name: 'PostToolUse', tool_name: 'LSP', tool_input: {}, cwd: CWD });
const lspFail = () => ({ hook_event_name: 'PostToolUse', tool_name: 'LSP', tool_input: {}, tool_response: { success: false }, cwd: CWD });
const isDeny = (o) => o?.hookSpecificOutput?.permissionDecision === 'deny';

beforeEach(() => { H.__resetSeenForTest(); resetState(CWD); });

test('search guard denies shell code-symbol grep', () => {
  const o = H.handlePreToolUse({ tool_name: 'Grep', tool_input: { pattern: 'parse_args', glob: '**/*.sh' }, cwd: CWD });
  assert.equal(isDeny(o), true);
});
test('search guard passes ambiguous (no shell target)', () => {
  const o = H.handlePreToolUse({ tool_name: 'Grep', tool_input: { pattern: 'parse_args' }, cwd: CWD });
  assert.deepEqual(o, {});
});
test('search guard passes non-symbol shell grep', () => {
  const o = H.handlePreToolUse({ tool_name: 'Grep', tool_input: { pattern: 'TODO', glob: '**/*.sh' }, cwd: CWD });
  assert.deepEqual(o, {});
});
test('Gate 1: first shell read is blocked until warmup', () => {
  assert.equal(isDeny(H.handlePreToolUse(read('/proj/a.sh'))), true);
});
test('non-shell read is never gated', () => {
  assert.deepEqual(H.handlePreToolUse(read('/proj/a.go')), {});
});
test('after 1 LSP call, reads 1-3 pass; gate 2 blocks read 4 until 2 LSP calls', () => {
  H.handlePostToolUse(lsp());                 // navCount=1, warmupDone
  for (let i = 0; i < 3; i++) assert.deepEqual(H.handlePreToolUse(read('/proj/a.sh')), {});
  assert.equal(isDeny(H.handlePreToolUse(read('/proj/a.sh'))), true); // read #4, navCount=1 < 2 -> gate 2 fires
});
test('surgical mode: 2 LSP calls unlock unlimited reads', () => {
  H.handlePostToolUse(lsp()); H.handlePostToolUse(lsp()); // navCount=2
  for (let i = 0; i < 10; i++) assert.deepEqual(H.handlePreToolUse(read('/proj/a.sh')), {});
});
test('escape hatch: blocked reads with zero LSP release after ESCAPE_THRESHOLD', () => {
  assert.equal(isDeny(H.handlePreToolUse(read('/proj/a.sh'))), true); // blockedNoNav=1
  assert.equal(isDeny(H.handlePreToolUse(read('/proj/a.sh'))), true); // blockedNoNav=2 -> sets lspUnavailable
  assert.deepEqual(H.handlePreToolUse(read('/proj/a.sh')), {});       // now fail-open
});
test('post-warmup escape hatch: 1 LSP call then ESCAPE_THRESHOLD blocked reads release (F1)', () => {
  H.handlePostToolUse(lsp());                                         // navCount=1, warmupDone
  for (let i = 0; i < 3; i++) assert.deepEqual(H.handlePreToolUse(read('/proj/a.sh')), {}); // reads 1-3 pass
  assert.equal(isDeny(H.handlePreToolUse(read('/proj/a.sh'))), true); // read 4: gate 2, blockedNoNav=1
  assert.equal(isDeny(H.handlePreToolUse(read('/proj/a.sh'))), true); // read 5: gate 2, blockedNoNav=2
  assert.deepEqual(H.handlePreToolUse(read('/proj/a.sh')), {});       // read 6: escape hatch -> fail-open
});
test('first-sighting reset wipes inherited surgical mode once per process', () => {
  H.handlePostToolUse(lsp()); H.handlePostToolUse(lsp());
  H.__resetSeenForTest();                       // simulate new server process, same cwd
  assert.equal(isDeny(H.handlePreToolUse(read('/proj/a.sh'))), true); // reset re-armed Gate 1
});
test('malformed event fails open', () => {
  assert.deepEqual(H.handlePreToolUse(null), {});
  assert.deepEqual(H.handlePreToolUse({ tool_name: 'Read', tool_input: 42 }), {});
});

// M4.3 regression + coverage additions

test('search guard denies Grep alternation pattern on shell target (I1 regression)', () => {
  const o = H.handlePreToolUse({ tool_name: 'Grep', tool_input: { pattern: 'parse_args|run_tests', glob: '**/*.sh' }, cwd: CWD });
  assert.equal(isDeny(o), true);
});

test('search guard denies Glob with shell symbol token', () => {
  const o = H.handlePreToolUse({ tool_name: 'Glob', tool_input: { pattern: '**/*parse_args*.sh' }, cwd: CWD });
  assert.equal(isDeny(o), true);
});
test('search guard passes Glob with non-shell extension', () => {
  const o = H.handlePreToolUse({ tool_name: 'Glob', tool_input: { pattern: '**/*parse_args*.go' }, cwd: CWD });
  assert.deepEqual(o, {});
});

test('search guard denies Bash grep with shell symbol on shell file', () => {
  const o = H.handlePreToolUse({ tool_name: 'Bash', tool_input: { command: 'grep parse_args src/app.sh' }, cwd: CWD });
  assert.equal(isDeny(o), true);
});
test('search guard passes Bash grep with shell symbol on non-shell file', () => {
  const o = H.handlePreToolUse({ tool_name: 'Bash', tool_input: { command: 'grep parse_args src/app.go' }, cwd: CWD });
  assert.deepEqual(o, {});
});

test('PostToolUse LSP success re-arms the read gate (one nav re-gates, two enter surgical mode)', () => {
  // Trigger escape hatch: 2 blocked reads -> lspUnavailable, 3rd passes fail-open.
  // readCount climbs to 2 (reads 1-2 increment; read 3 short-circuits at the entry check).
  assert.equal(isDeny(H.handlePreToolUse(read('/proj/a.sh'))), true); // readCount=1, blockedNoNav=1
  assert.equal(isDeny(H.handlePreToolUse(read('/proj/a.sh'))), true); // readCount=2, blockedNoNav=2 -> lspUnavailable=true
  assert.deepEqual(H.handlePreToolUse(read('/proj/a.sh')), {});       // lspUnavailable: fail-open

  // ONE successful LSP call genuinely re-arms the gate: lspUnavailable=false,
  // navCount=1, blockedNoNav reset to 0 (without the reset the entry check would
  // short-circuit to ALLOW and re-set lspUnavailable, so the gate could never re-arm).
  H.handlePostToolUse(lsp());                                         // navCount=1, blockedNoNav=0
  assert.deepEqual(H.handlePreToolUse(read('/proj/a.sh')), {});       // readCount=3 (<GATE2_AT): pass
  assert.equal(isDeny(H.handlePreToolUse(read('/proj/a.sh'))), true); // readCount=4 (>=GATE2_AT), navCount=1<2 -> gate 2 re-fires

  // A SECOND successful LSP call (navCount=2) enters surgical mode -> reads pass.
  H.handlePostToolUse(lsp());                                          // navCount=2 -> surgical mode
  for (let i = 0; i < 5; i++) assert.deepEqual(H.handlePreToolUse(read('/proj/a.sh')), {});
});

test('PostToolUse failed LSP (success:false) does NOT re-arm: navCount stays 0, escape hatch holds (F4)', () => {
  // Engage the escape hatch with zero LSP calls: 2 blocked reads (blockedNoNav=2),
  // then the 3rd read entry sets lspUnavailable=true and fails open.
  assert.equal(isDeny(H.handlePreToolUse(read('/proj/a.sh'))), true); // blockedNoNav=1
  assert.equal(isDeny(H.handlePreToolUse(read('/proj/a.sh'))), true); // blockedNoNav=2
  assert.deepEqual(H.handlePreToolUse(read('/proj/a.sh')), {});       // entry check -> lspUnavailable=true, fail-open
  assert.equal(readState(CWD).lspUnavailable, true);
  assert.equal(readState(CWD).navCount, 0);

  // A FAILED LSP call must not advance state: navCount unchanged, hatch still engaged.
  H.handlePostToolUse(lspFail());
  assert.equal(readState(CWD).navCount, 0, 'failed LSP must not bump navCount');
  assert.equal(readState(CWD).lspUnavailable, true, 'failed LSP must not clear lspUnavailable');

  // Reads keep flowing via the (still-engaged) hatch — the gate was NOT re-armed.
  // Under the bug the cleared hatch + navCount=1 would re-deny once readCount>=GATE2_AT.
  for (let i = 0; i < 5; i++) assert.deepEqual(H.handlePreToolUse(read('/proj/a.sh')), {});
});

test('PostToolUse LSP with explicit success:true re-arms the gate as before (F4 positive)', () => {
  const ok = () => ({ hook_event_name: 'PostToolUse', tool_name: 'LSP', tool_input: {}, tool_response: { success: true }, cwd: CWD });
  H.handlePostToolUse(ok());                                          // navCount=1, warmupDone
  assert.equal(readState(CWD).navCount, 1);
  assert.equal(readState(CWD).warmupDone, true);
  for (let i = 0; i < 3; i++) assert.deepEqual(H.handlePreToolUse(read('/proj/a.sh')), {}); // reads 1-3 pass
});
