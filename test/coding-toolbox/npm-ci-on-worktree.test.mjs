import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isNpmCiEnabled,
  truncate,
} from "../../plugins/coding-toolbox/hooks/npm-ci-on-worktree.mjs";

test('isNpmCiEnabled: fail-open, only literal "false" disables', () => {
  assert.equal(isNpmCiEnabled("true"), true);
  assert.equal(isNpmCiEnabled("false"), false);
  assert.equal(isNpmCiEnabled(""), true);
  assert.equal(isNpmCiEnabled(undefined), true);
  assert.equal(isNpmCiEnabled("${user_config.npm_ci_on_worktree}"), true);
});

test("truncate: passes short text through unchanged", () => {
  assert.equal(truncate("short output"), "short output");
});

test("truncate: caps long text at 4000 chars with a truncation marker", () => {
  const long = "x".repeat(5000);
  const out = truncate(long);
  assert.ok(out.length < long.length);
  assert.match(out, /\(truncated\)$/);
});
