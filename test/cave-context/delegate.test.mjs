import { test } from "node:test";
import assert from "node:assert/strict";
import { delegateHook } from "../../plugins/cave-context/mcp/delegate.mjs";

const FAKE = JSON.stringify(["node", new URL("./fake-hook.mjs", import.meta.url).pathname]);

test("delegate merges fake upstream additionalContext", async () => {
  process.env.CAVE_CONTEXT_HOOK_CMD = FAKE;
  const out = await delegateHook("UserPromptSubmit", { prompt: "x" });
  assert.equal(out.hookSpecificOutput.additionalContext, "CTXMODE[UserPromptSubmit]");
});

test("delegate returns null when disabled", async () => {
  delete process.env.CAVE_CONTEXT_HOOK_CMD;
  process.env.CAVE_CONTEXT_NO_UPSTREAM = "1";
  const out = await delegateHook("UserPromptSubmit", { prompt: "x" });
  assert.equal(out, null);
  delete process.env.CAVE_CONTEXT_NO_UPSTREAM;
});

test("delegate returns null on bad command (fail-open)", async () => {
  process.env.CAVE_CONTEXT_HOOK_CMD = JSON.stringify(["definitely-not-a-real-bin-xyz"]);
  const out = await delegateHook("PreCompact", {});
  assert.equal(out, null);
  delete process.env.CAVE_CONTEXT_HOOK_CMD;
});
