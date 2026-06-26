// fire-and-forget.test.mjs — the hook execution-time optimization:
//   - capture-tracker: in-flight registry + drain semantics
//   - PostToolUse / UserPromptSubmit: context-mode capture runs fire-and-forget (not awaited)
//   - PreCompact: drains in-flight captures before building the resume snapshot (consistency)
// See docs/cave-context-hook-fire-and-forget-analysis.md for the per-hook rationale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const H = (p) => fileURLToPath(new URL(`../../plugins/cave-context/bin/context-mode/hooks/${p}`, import.meta.url));
const TRACKER = "../../plugins/cave-context/mcp/capture-tracker.mjs";
const HANDLERS = "../../plugins/cave-context/mcp/handlers.mjs";

function scratch() { return mkdtempSync(join(tmpdir(), "faf-test-")); }

async function withEnv(vars, fn) {
  const prior = {};
  for (const k of Object.keys(vars)) prior[k] = process.env[k];
  Object.assign(process.env, vars);
  try { return await fn(); }
  finally {
    for (const k of Object.keys(vars)) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
}

// ── capture-tracker semantics ──────────────────────────────────────────────────

test("capture-tracker: trackCapture counts a pending promise; drain awaits then clears it", async () => {
  const { trackCapture, drainCaptures, inflightCount } = await import(TRACKER);
  let resolveFn;
  const p = new Promise((r) => { resolveFn = r; });
  const before = inflightCount();
  assert.equal(trackCapture(p), p, "trackCapture returns the original promise");
  assert.equal(inflightCount(), before + 1, "pending capture is counted in flight");

  let drained = false;
  const drainP = drainCaptures().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false, "drain must NOT resolve while a capture is in flight");

  resolveFn();
  await drainP;
  assert.equal(drained, true, "drain resolves once the capture settles");
  assert.equal(inflightCount(), before, "settled capture is removed from the in-flight set");
});

test("capture-tracker: a rejecting capture is swallowed (drain never throws)", async () => {
  const { trackCapture, drainCaptures } = await import(TRACKER);
  trackCapture(Promise.reject(new Error("boom")));
  await drainCaptures(); // must not throw
  assert.ok(true);
});

test("capture-tracker: non-thenables pass through untracked", async () => {
  const { trackCapture, inflightCount } = await import(TRACKER);
  const before = inflightCount();
  assert.equal(trackCapture(undefined), undefined);
  assert.equal(trackCapture(42), 42);
  assert.equal(inflightCount(), before, "non-promises are not tracked");
});

// ── PostToolUse fire-and-forget ─────────────────────────────────────────────────

test("handlePostToolUse: returns {} without awaiting capture (capture left in flight)", async () => {
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, async () => {
    const { handlePostToolUse } = await import(HANDLERS);
    const { inflightCount, drainCaptures } = await import(TRACKER);
    const before = inflightCount();
    const out = await handlePostToolUse({
      session_id: "s-faf-ptu", cwd: dir, hook_event_name: "PostToolUse",
      tool_name: "Bash", tool_input: { command: "git status" }, tool_response: "On branch main\nnothing to commit",
    });
    assert.deepEqual(out, {}, "PostToolUse returns {} immediately (non-blocking parity)");
    assert.ok(inflightCount() > before, "capture must still be in flight — the hook did not await it");
    await drainCaptures();
  });
});

test("handlePostToolUse: the fire-and-forget capture lands in the DB after drain", async () => {
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, async () => {
    const { handlePostToolUse } = await import(HANDLERS);
    const { drainCaptures } = await import(TRACKER);
    const sessionId = "s-faf-ptu-db";
    await handlePostToolUse({
      session_id: sessionId, cwd: dir, hook_event_name: "PostToolUse",
      tool_name: "Bash", tool_input: { command: "git status" }, tool_response: "On branch main\nnothing to commit",
    });
    await drainCaptures();
    const { SessionDB } = await import(H("session-db.bundle.mjs"));
    const { getSessionDBPath } = await import(H("session-helpers.mjs"));
    const reader = new SessionDB({ dbPath: getSessionDBPath() });
    const rollup = reader.getSessionRollup(sessionId);
    reader.close();
    assert.ok(rollup.tool_calls >= 1, `capture must land after drain, got tool_calls=${rollup.tool_calls}`);
  });
});

// ── UserPromptSubmit fire-and-forget (caveman reminder stays synchronous) ────────

test("handleUserPromptSubmit: emits caveman reminder synchronously, captures fire-and-forget", async () => {
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, async () => {
    const { handleUserPromptSubmit } = await import(HANDLERS);
    const { reminderText } = await import("../../plugins/cave-context/mcp/caveman.mjs");
    const { inflightCount, drainCaptures } = await import(TRACKER);
    const before = inflightCount();
    const out = await handleUserPromptSubmit({
      hook_event_name: "UserPromptSubmit", cwd: dir, session_id: "s-faf-ups", prompt: "please write a hello world script",
    });
    assert.ok(out.hookSpecificOutput.additionalContext.includes(reminderText()),
      "caveman reminder must be emitted synchronously this turn");
    assert.ok(inflightCount() > before, "context-mode capture must be fire-and-forget (not awaited)");
    await drainCaptures();
    const { SessionDB } = await import(H("session-db.bundle.mjs"));
    const { getSessionDBPath } = await import(H("session-helpers.mjs"));
    const reader = new SessionDB({ dbPath: getSessionDBPath() });
    const events = reader.getEvents("s-faf-ups", { type: "user_prompt" });
    reader.close();
    assert.ok(events.length >= 1, `user_prompt captured after drain, got ${events.length}`);
  });
});

// ── PreCompact drains before snapshot (the load-bearing consistency guarantee) ───

test("handlePreCompact: drains an in-flight PostToolUse capture into the resume snapshot", async () => {
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, async () => {
    const { handlePostToolUse, handlePreCompact } = await import(HANDLERS);
    const sessionId = "s-faf-drain";
    // Producer fires fire-and-forget; deliberately do NOT drain here — the capture is in flight.
    await handlePostToolUse({
      session_id: sessionId, cwd: dir, hook_event_name: "PostToolUse",
      tool_name: "Bash", tool_input: { command: "git status" }, tool_response: "On branch main\nnothing to commit",
    });
    // PreCompact must internally drain the in-flight capture before building the snapshot.
    const res = await handlePreCompact({ session_id: sessionId, cwd: dir, hook_event_name: "PreCompact" });
    assert.deepEqual(res, {});
    const { SessionDB } = await import(H("session-db.bundle.mjs"));
    const { getSessionDBPath } = await import(H("session-helpers.mjs"));
    const reader = new SessionDB({ dbPath: getSessionDBPath() });
    const resume = reader.getResume(sessionId);
    const rollup = reader.getSessionRollup(sessionId);
    reader.close();
    assert.ok(resume, "PreCompact must persist a resume snapshot");
    assert.ok(rollup.tool_calls >= 1,
      `snapshot must include the drained capture, got tool_calls=${rollup.tool_calls}`);
  });
});
