import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCodeSymbol, stripZeroWidth, isJsTarget, extractGrepTargets } from '../../plugins/js-lsp/mcp/symbols.mjs';

// --- kit allow/block matrix (the acceptance spec) ---
const BLOCK = ['getUserById', 'UserService', 'router.refresh', 'write_audit_log', 'create-folder-modal', 'createOrder', 'handleSubmit', 'get_user_sessions'];
const ALLOW = ['TODO', 'NEXT_PUBLIC_URL', 'flex-col', 'subdomain', 'auth', 'middleware', 'readme'];

test('blocks code symbols', () => {
  for (const t of BLOCK) assert.equal(isCodeSymbol(t), true, `${t} should be a symbol`);
  // /i fidelity: mixed-case dotted symbol must be detected (kit lsp-first-guard.js:95)
  assert.equal(isCodeSymbol('Router.refresh'), true, 'Router.refresh (mixed-case dotted) should be a symbol');
});
test('allows non-symbols', () => {
  for (const t of ALLOW) assert.equal(isCodeSymbol(t), false, `${t} should be allowed`);
});

// --- security: type-confusion fail-open ---
test('non-string input never throws (fail-open coercion)', () => {
  for (const v of [null, undefined, 42, ['x'], {}]) {
    assert.doesNotThrow(() => isCodeSymbol(v));
    assert.equal(isCodeSymbol(v), false);
  }
});

// --- security: zero-width bypass ---
test('strips zero-width chars before detection', () => {
  assert.equal(stripZeroWidth('Func​Name'), 'FuncName');
  assert.equal(isCodeSymbol('Func​Name'), true);
});

// --- grep extraction ---
test('extractGrepTargets: grep is grep, git grep is not', () => {
  assert.equal(extractGrepTargets('grep getUserById src/a.js').isGrep, true);
  assert.equal(extractGrepTargets('git grep getUserById').isGrep, false);
  assert.equal(extractGrepTargets('GREP -r Foo').isGrep, true); // case-insensitive
});

// --- JS-target scoping (NEW) ---
test('isJsTarget: Read', () => {
  assert.equal(isJsTarget('Read', { file_path: '/a/b/foo.js' }), true);
  assert.equal(isJsTarget('Read', { file_path: '/a/b/foo.jsx' }), true);
  assert.equal(isJsTarget('Read', { file_path: '/a/b/foo.go' }), false);
  assert.equal(isJsTarget('Read', { file_path: '/a/b/foo.ts' }), false);
});
test('isJsTarget: Grep needs a JS glob/path', () => {
  assert.equal(isJsTarget('Grep', { pattern: 'getUserById', glob: '**/*.js' }), true);
  assert.equal(isJsTarget('Grep', { pattern: 'getUserById' }), false); // ambiguous -> pass
  assert.equal(isJsTarget('Grep', { pattern: 'getUserById', glob: '**/*.go' }), false);
});
test('isJsTarget: Glob pattern targets JS files', () => {
  assert.equal(isJsTarget('Glob', { pattern: '**/*Service*.js' }), true);
  assert.equal(isJsTarget('Glob', { pattern: '**/*Service*.go' }), false);
  assert.equal(isJsTarget('Glob', { pattern: '**/*Service*' }), false); // ambiguous -> pass
});
test('isJsTarget: Bash grep on a JS file', () => {
  assert.equal(isJsTarget('Bash', { command: 'grep getUserById src/app.js' }), true);
  assert.equal(isJsTarget('Bash', { command: 'grep getUserById src/app.go' }), false);
  assert.equal(isJsTarget('Bash', { command: 'grep getUserById' }), false); // ambiguous -> pass
});
