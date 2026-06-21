import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CLAUDE_PLUGIN_DATA = mkdtempSync(join(tmpdir(), 'jslsp-'));
const { freshState, readState, writeState, resetState, statePath } = await import('../../plugins/js-lsp/mcp/state.mjs');

const CWD = '/fake/project';

test('readState returns fresh when none exists', () => {
  assert.deepEqual(readState('/never/seen'), freshState());
});
test('write then read round-trips', () => {
  const s = { ...freshState(), navCount: 2, warmupDone: true };
  writeState(CWD, s);
  const r = readState(CWD);
  assert.equal(r.navCount, 2);
  assert.equal(r.warmupDone, true);
});
test('stale state (>24h) reads as fresh', () => {
  // Write the stale file directly (bypassing writeState which always refreshes `updated`)
  // so the 24h-expiry branch in readState is actually exercised.
  writeFileSync(statePath(CWD), JSON.stringify({ ...freshState(), navCount: 5, updated: Date.now() - 25 * 3600 * 1000 }));
  assert.deepEqual(readState(CWD), freshState());
});
test('resetState wipes', () => {
  writeState(CWD, { ...freshState(), navCount: 3 });
  resetState(CWD);
  assert.deepEqual(readState(CWD), freshState());
});
test('writeState never throws on bad dir', () => {
  assert.doesNotThrow(() => writeState(' bad', freshState()));
});
