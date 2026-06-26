import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// state.mjs may read CLAUDE_PLUGIN_DATA at import; set it before importing handlers.
process.env.CLAUDE_PLUGIN_DATA = mkdtempSync(join(tmpdir(), 'lspmsg-'));

const js = await import('../../plugins/js-lsp/mcp/handlers.mjs');
const ts = await import('../../plugins/ts-lsp/mcp/handlers.mjs');
const sh = await import('../../plugins/shell-lsp/mcp/handlers.mjs');

test('LSP_HINT is word-identical across the three handlers', () => {
  assert.equal(js.LSP_HINT(), ts.LSP_HINT());
  assert.equal(js.LSP_HINT(), sh.LSP_HINT());
});

test('WARMUP_HINT is word-identical given the same file arg', () => {
  const f = '/proj/x.ext';
  assert.equal(js.WARMUP_HINT(f), ts.WARMUP_HINT(f));
  assert.equal(js.WARMUP_HINT(f), sh.WARMUP_HINT(f));
});

test('GATE2_HINT is word-identical given the same args', () => {
  const f = '/proj/x.ext';
  assert.equal(js.GATE2_HINT(f, 4), ts.GATE2_HINT(f, 4));
  assert.equal(js.GATE2_HINT(f, 4), sh.GATE2_HINT(f, 4));
});

test('messages carry the neutral lsp: prefix and no plugin name', () => {
  const all = [js.LSP_HINT(), js.WARMUP_HINT('/f'), js.GATE2_HINT('/f', 4)];
  for (const m of all) {
    assert.match(m, /^lsp:/);
    assert.doesNotMatch(m, /js-lsp|ts-lsp|shell-lsp/);
  }
});
