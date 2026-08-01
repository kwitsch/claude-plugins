import { test } from "node:test";
import assert from "node:assert/strict";
import { flagPathFor } from "../../plugins/memory-enhancement/hooks/flag-dream-due.mjs";
import { isAutoDreamEnabled } from "../../plugins/memory-enhancement/hooks/check-dream-due.mjs";

test("flagPathFor is deterministic for the same project dir", () => {
  assert.equal(flagPathFor("/tmp/project-a"), flagPathFor("/tmp/project-a"));
});

test("flagPathFor differs for different project dirs", () => {
  assert.notEqual(flagPathFor("/tmp/project-a"), flagPathFor("/tmp/project-b"));
});

test("flagPathFor uses an 8-hex-char hash suffix", () => {
  const p = flagPathFor("/tmp/project-a");
  assert.match(p, /dream-due-[0-9a-f]{8}\.flag$/);
});

test('isAutoDreamEnabled: fail-open, only literal "false" disables', () => {
  assert.equal(isAutoDreamEnabled("true"), true);
  assert.equal(isAutoDreamEnabled("false"), false);
  assert.equal(isAutoDreamEnabled(""), true);
  assert.equal(isAutoDreamEnabled(undefined), true);
  assert.equal(isAutoDreamEnabled("${user_config.auto_dream}"), true);
});
