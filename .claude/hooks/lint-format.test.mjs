import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldLint, buildContext } from './lint-format.mjs';

test('shouldLint matches .mjs and .js, rejects other extensions', () => {
  assert.equal(shouldLint('plugins/x/hooks/foo.mjs'), true);
  assert.equal(shouldLint('plugins/x/hooks/foo.js'), true);
  assert.equal(shouldLint('plugins/x/hooks/foo.py'), false);
  assert.equal(shouldLint('plugins/x/hooks/foo.mjs.bak'), false);
});

test('buildContext returns null for empty/whitespace-only lint output', () => {
  assert.equal(buildContext(''), null);
  assert.equal(buildContext('   \n  '), null);
});

test('buildContext wraps non-empty lint output as PostToolUse additionalContext', () => {
  const result = buildContext('  some/file.mjs: 1 warning  \n');
  assert.deepEqual(result, {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: 'some/file.mjs: 1 warning',
    },
  });
});
