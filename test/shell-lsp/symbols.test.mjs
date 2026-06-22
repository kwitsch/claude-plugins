import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShellCodeSymbol, isShellTarget, extractGrepTargets } from '../../plugins/shell-lsp/mcp/symbols.mjs';

const SYMBOLS = ['deploy_app', 'git::push', 'log::info', 'parse_args', 'build_image', 'run_tests', 'file_path', 'is_ok'];
const NOT_SYMBOLS = ['run', 'main', 'setup', 'cd', 'i', 'PATH', 'HOME', 'MY_VAR', 'foo', 'usr/bin', 'echo', 'a_b'];

test('isShellCodeSymbol: positives', () => {
  for (const s of SYMBOLS) assert.equal(isShellCodeSymbol(s), true, `${s} should be a symbol`);
});

test('isShellCodeSymbol: negatives', () => {
  for (const s of NOT_SYMBOLS) assert.equal(isShellCodeSymbol(s), false, `${s} should NOT be a symbol`);
});

test('isShellCodeSymbol: non-string input never throws (fail-open false)', () => {
  for (const v of [null, undefined, 42, [], {}]) assert.equal(isShellCodeSymbol(v), false);
});

test('isShellTarget: Read', () => {
  assert.equal(isShellTarget('Read', { file_path: 'deploy.sh' }), true);
  assert.equal(isShellTarget('Read', { file_path: 'app.bash' }), true);
  assert.equal(isShellTarget('Read', { file_path: 'app.js' }), false);
});

test('isShellTarget: Grep glob/path', () => {
  assert.equal(isShellTarget('Grep', { pattern: 'parse_args', glob: '*.bash' }), true);
  assert.equal(isShellTarget('Grep', { pattern: 'parse_args', glob: '*.ts' }), false);
});

test('isShellTarget: Glob', () => {
  assert.equal(isShellTarget('Glob', { pattern: '**/*.sh' }), true);
  assert.equal(isShellTarget('Glob', { pattern: '**/*.js' }), false);
});

test('isShellTarget: Bash grep on a shell file', () => {
  assert.equal(isShellTarget('Bash', { command: 'grep parse_args deploy.sh' }), true);
  assert.equal(isShellTarget('Bash', { command: 'grep foo deploy.js' }), false);
});

test('extractGrepTargets: alternation splits on | but namespaced symbols keep ::', () => {
  const { isGrep, symbols } = extractGrepTargets('grep -E "git::push|log::info" deploy.sh');
  assert.equal(isGrep, true);
  assert.ok(symbols.includes('git::push'), 'git::push must survive intact');
  assert.ok(symbols.includes('log::info'), 'log::info must survive intact');
});

test('extractGrepTargets: git grep is excluded (isGrep false)', () => {
  const { isGrep } = extractGrepTargets('git grep foo deploy.sh');
  assert.equal(isGrep, false);
});
