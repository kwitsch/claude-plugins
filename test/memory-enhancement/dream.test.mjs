import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NUDGE, dueKey, isAutoDreamEnabled } from "../../plugins/memory-enhancement/hooks/dream.mjs";

test("dueKey is deterministic for the same project dir", async () => {
  assert.equal(await dueKey("/tmp/project-a"), await dueKey("/tmp/project-a"));
});

test("dueKey differs for different project dirs", async () => {
  assert.notEqual(await dueKey("/tmp/project-a"), await dueKey("/tmp/project-b"));
});

test("dueKey uses an 8-hex-char hash suffix", async () => {
  assert.match(await dueKey("/tmp/project-a"), /^dream-due:[0-9a-f]{8}$/);
});

test("dueKey's hash is the 0.4.x flag file's node:crypto hash", async () => {
  for (const dir of ["/tmp/project-a", "/home/u/repos/ünïcode dir", "C:\\x\\y"]) {
    const old = createHash("sha256").update(dir).digest("hex").slice(0, 8);
    assert.equal(await dueKey(dir), `dream-due:${old}`);
  }
});

test('isAutoDreamEnabled: fail-open, only false / "false" disables', () => {
  assert.equal(isAutoDreamEnabled(true), true);
  assert.equal(isAutoDreamEnabled("true"), true);
  assert.equal(isAutoDreamEnabled(false), false);
  assert.equal(isAutoDreamEnabled("false"), false);
  assert.equal(isAutoDreamEnabled(""), true);
  assert.equal(isAutoDreamEnabled(undefined), true);
  assert.equal(isAutoDreamEnabled("${user_config.auto_dream}"), true);
});

test("NUDGE names the dream cycle and the MEMORY.md index", () => {
  assert.match(NUDGE, /^A memory dream cycle is due for this project\./);
  assert.match(NUDGE, /MEMORY\.md index/);
});
