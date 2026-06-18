import { test } from "node:test";
import assert from "node:assert/strict";
import { handleUserPromptSubmit, handlePreToolUse, mergeContext } from "../../plugins/cave-context/mcp/handlers.mjs";
import { reminderText } from "../../plugins/cave-context/mcp/caveman.mjs";

const FAKE = JSON.stringify(["node", new URL("./fake-hook.mjs", import.meta.url).pathname]);
const FAKE_HARD = JSON.stringify(["node", new URL("./fake-hook-hard.mjs", import.meta.url).pathname]);

// Set env vars for the duration of fn(), restoring each to its prior value afterwards
// (deleting only those that were originally undefined) so tests don't contaminate each
// other or leak into the parent process.
async function withEnv(vars, fn) {
  const prior = {};
  for (const k of Object.keys(vars)) prior[k] = process.env[k];
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
}

test("mergeContext joins both, caveman first", () => {
  assert.equal(mergeContext("CAVE", "CTX"), "CAVE\n\nCTX");
  assert.equal(mergeContext("CAVE", null), "CAVE");
  assert.equal(mergeContext(null, "CTX"), "CTX");
  assert.equal(mergeContext(null, null), null);
});

test("UserPromptSubmit: always-full reminder + ctx merge (ignores /caveman args)", async () => {
  await withEnv({ CAVE_CONTEXT_HOOK_CMD: FAKE }, async () => {
    // The "/caveman ultra" arg must be ignored — the level is fixed at full.
    const out = await handleUserPromptSubmit({ hook_event_name: "UserPromptSubmit", prompt: "/caveman ultra" });
    const ac = out.hookSpecificOutput.additionalContext;
    assert.ok(ac.includes(reminderText()));   // merged output carries the reminder verbatim
    assert.doesNotMatch(ac, /ultra/);
    // delegate lowercases the event before invoking the CLI; the fake echoes it back.
    assert.match(ac, /CTXMODE\[userpromptsubmit\]/);
  });
});

test("PreToolUse: no upstream, no caveman -> benign {} (no throw)", async () => {
  await withEnv({ CAVE_CONTEXT_NO_UPSTREAM: "1" }, async () => {
    const out = await handlePreToolUse({ hook_event_name: "PreToolUse", tool_name: "Bash" });
    // No upstream, no caveman PreToolUse → benign empty-ish output (no throw)
    assert.ok(out && typeof out === "object");
  });
});

test("PreToolUse: forwards ctx hard fields (permissionDecision/updatedInput/decision/reason)", async () => {
  await withEnv({ CAVE_CONTEXT_HOOK_CMD: FAKE_HARD }, async () => {
    const out = await handlePreToolUse({ hook_event_name: "PreToolUse", tool_name: "Bash" });
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(out.hookSpecificOutput.permissionDecisionReason, "blocked by ctx");
    assert.deepEqual(out.updatedInput, { command: "echo safe" });
    assert.equal(out.decision, "block");
    assert.equal(out.reason, "blocked: unsafe command");
  });
});

