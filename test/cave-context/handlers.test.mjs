import { test } from "node:test";
import assert from "node:assert/strict";
import { handleUserPromptSubmit, handlePreToolUse, mergeContext } from "../../plugins/cave-context/mcp/handlers.mjs";
import { reminderText } from "../../plugins/cave-context/mcp/caveman.mjs";

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

test("UserPromptSubmit: always-full reminder (ignores /caveman args, no CLI spawn)", async () => {
  // delegateHook now runs in-process (no CLI); UserPromptSubmit is capture-only and
  // returns null — additionalContext is caveman-only (no CTXMODE marker). The capture is now
  // fire-and-forget; CAVE_CONTEXT_NO_UPSTREAM=1 short-circuits it so this reminder-only
  // assertion does no background DB work.
  const out = await withEnv({ CAVE_CONTEXT_NO_UPSTREAM: "1" }, () =>
    handleUserPromptSubmit({ hook_event_name: "UserPromptSubmit", prompt: "/caveman ultra" }));
  const ac = out.hookSpecificOutput.additionalContext;
  assert.ok(ac.includes(reminderText()), "merged output must carry the full caveman reminder");
  assert.doesNotMatch(ac, /ultra/);
  // No CLI spawn: CTXMODE marker is gone; caveman is the sole additionalContext source.
  assert.doesNotMatch(ac, /CTXMODE/, "no CLI spawn: CTXMODE marker must not appear");
});

test("PreToolUse: no upstream, no caveman -> benign {} (no throw)", async () => {
  await withEnv({ CAVE_CONTEXT_NO_UPSTREAM: "1" }, async () => {
    const out = await handlePreToolUse({ hook_event_name: "PreToolUse", tool_name: "Bash" });
    // No upstream, no caveman PreToolUse → benign empty-ish output (no throw)
    assert.ok(out && typeof out === "object");
  });
});

test("PreToolUse: in-process routing — a benign tool yields no hard deny", async () => {
  // PreToolUse now runs context-mode routing in-process (Task 4). A benign Bash command
  // produces no deny/redirect, so handlePreToolUse returns a benign object with no
  // permissionDecision:"deny" (hard-field forwarding itself is unit-tested in delegate.test.mjs).
  await withEnv({ CAVE_CONTEXT_NO_UPSTREAM: "0" }, async () => {
    const out = await handlePreToolUse({ hook_event_name: "PreToolUse", tool_name: "Bash" });
    assert.ok(out && typeof out === "object", "must return an object");
    // No hard fields from stub; hookSpecificOutput absent (or caveman-less)
    assert.notEqual(out?.hookSpecificOutput?.permissionDecision, "deny");
  });
});

test("PreToolUse: WebFetch is denied with a ctx_fetch_and_index hint (main agent)", async () => {
  await withEnv({ CAVE_CONTEXT_NO_UPSTREAM: "1" }, async () => {
    const out = await handlePreToolUse({ hook_event_name: "PreToolUse", tool_name: "WebFetch" });
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /ctx_fetch_and_index/);
  });
});

test("PreToolUse: WebFetch inside a subagent is NOT denied (agent_id present)", async () => {
  await withEnv({ CAVE_CONTEXT_NO_UPSTREAM: "1" }, async () => {
    const out = await handlePreToolUse({ hook_event_name: "PreToolUse", tool_name: "WebFetch", agent_id: "a1" });
    assert.notEqual(out?.hookSpecificOutput?.permissionDecision, "deny");
  });
});

