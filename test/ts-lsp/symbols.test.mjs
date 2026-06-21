import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCodeSymbol, stripZeroWidth, isTsTarget, extractGrepTargets } from '../../plugins/ts-lsp/mcp/symbols.mjs';

// --- kit allow/block matrix (the acceptance spec) ---
const BLOCK = ['getUserById', 'UserService', 'router.refresh', 'write_audit_log', 'create-folder-modal', 'createOrder', 'handleSubmit', 'get_user_sessions'];
const ALLOW = ['TODO', 'NEXT_PUBLIC_URL', 'flex-col', 'subdomain', 'auth', 'middleware', 'readme'];

test('blocks code symbols', () => {
  for (const t of BLOCK) assert.equal(isCodeSymbol(t), true, `${t} should be a symbol`);
  // /i fidelity: mixed-case dotted symbol must be detected (kit lsp-first-guard.ts:95)
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
  assert.equal(extractGrepTargets('grep getUserById src/a.ts').isGrep, true);
  assert.equal(extractGrepTargets('git grep getUserById').isGrep, false);
  assert.equal(extractGrepTargets('GREP -r Foo').isGrep, true); // case-insensitive
});

// --- TS-target scoping (NEW) ---
test('isTsTarget: Read', () => {
  assert.equal(isTsTarget('Read', { file_path: '/a/b/foo.ts' }), true);
  assert.equal(isTsTarget('Read', { file_path: '/a/b/foo.tsx' }), true);
  assert.equal(isTsTarget('Read', { file_path: '/a/b/foo.go' }), false);
  assert.equal(isTsTarget('Read', { file_path: '/a/b/foo.js' }), false); // JS now passes through
});
test('isTsTarget: Grep needs a TS glob/path', () => {
  assert.equal(isTsTarget('Grep', { pattern: 'getUserById', glob: '**/*.ts' }), true);
  assert.equal(isTsTarget('Grep', { pattern: 'getUserById' }), false); // ambiguous -> pass
  assert.equal(isTsTarget('Grep', { pattern: 'getUserById', glob: '**/*.go' }), false);
});
test('isTsTarget: Glob pattern targets TS files', () => {
  assert.equal(isTsTarget('Glob', { pattern: '**/*Service*.ts' }), true);
  assert.equal(isTsTarget('Glob', { pattern: '**/*Service*.go' }), false);
  assert.equal(isTsTarget('Glob', { pattern: '**/*Service*' }), false); // ambiguous -> pass
});
test('isTsTarget: Bash grep on a TS file', () => {
  assert.equal(isTsTarget('Bash', { command: 'grep getUserById src/app.ts' }), true);
  assert.equal(isTsTarget('Bash', { command: 'grep getUserById src/app.go' }), false);
  assert.equal(isTsTarget('Bash', { command: 'grep getUserById' }), false); // ambiguous -> pass
});

// --- CR4: value-taking flags (rg -g/--glob) must not evade detection ---
test('extractGrepTargets: rg glob-flag value does not swallow the symbol', () => {
  // -g '*.ts' VALUE must not be mistaken for the search pattern.
  const a = extractGrepTargets("rg -g '*.ts' getUserById src");
  assert.ok(a.symbols.includes('getUserById'), 'symbol extracted past the -g value');
  const b = extractGrepTargets("rg getUserById --glob '*.ts'");
  assert.ok(b.symbols.includes('getUserById'), 'symbol extracted before the --glob flag');
});
test('isTsTarget: rg with a TS glob flag is TS-targeted; non-TS glob is not', () => {
  assert.equal(isTsTarget('Bash', { command: "rg -g '*.ts' getUserById src" }), true);
  assert.equal(isTsTarget('Bash', { command: "rg getUserById --glob '*.ts'" }), true);
  assert.equal(isTsTarget('Bash', { command: "rg --glob='*.ts' getUserById" }), true); // = form
  assert.equal(isTsTarget('Bash', { command: "rg -g '*.go' getUserById" }), false); // non-TS glob -> pass
});
test('extractGrepTargets: -e supplies the pattern, positional file is not a symbol', () => {
  // `grep -e foo UserService.ts` searches literal "foo"; the filename must NOT
  // be classified as the symbol UserService (no false positive).
  const r = extractGrepTargets('grep -e foo UserService.ts');
  assert.equal(r.symbols.includes('UserService'), false);
});
