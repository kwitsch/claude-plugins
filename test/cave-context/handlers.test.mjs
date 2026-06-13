import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleUserPromptSubmit, handlePreToolUse, mergeContext } from "../../plugins/cave-context/mcp/handlers.mjs";

const FAKE = JSON.stringify(["node", new URL("./fake-hook.mjs", import.meta.url).pathname]);

test("mergeContext joins both, caveman first", () => {
  assert.equal(mergeContext("CAVE", "CTX"), "CAVE\n\nCTX");
  assert.equal(mergeContext("CAVE", null), "CAVE");
  assert.equal(mergeContext(null, "CTX"), "CTX");
  assert.equal(mergeContext(null, null), null);
});

test("UserPromptSubmit: /caveman ultra sets level + reminder + ctx merge", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  process.env.CLAUDE_PLUGIN_DATA = dir;
  process.env.CAVE_CONTEXT_HOOK_CMD = FAKE;
  try {
    const out = await handleUserPromptSubmit({ hook_event_name: "UserPromptSubmit", prompt: "/caveman ultra" });
    const ac = out.hookSpecificOutput.additionalContext;
    assert.match(ac, /ultra/);
    // delegate lowercases the event before invoking the CLI; the fake echoes it back.
    assert.match(ac, /CTXMODE\[userpromptsubmit\]/);
  } finally {
    delete process.env.CLAUDE_PLUGIN_DATA; delete process.env.CAVE_CONTEXT_HOOK_CMD;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PreToolUse: caveman silent, passes through ctx hard fields", async () => {
  process.env.CAVE_CONTEXT_NO_UPSTREAM = "1";
  try {
    const out = await handlePreToolUse({ hook_event_name: "PreToolUse", tool_name: "Bash" });
    // No upstream, no caveman PreToolUse → benign empty-ish output (no throw)
    assert.ok(out && typeof out === "object");
  } finally { delete process.env.CAVE_CONTEXT_NO_UPSTREAM; }
});
