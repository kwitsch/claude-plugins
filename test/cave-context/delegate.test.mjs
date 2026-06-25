import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the vendored SessionDB so the DB-rows assertions can open a reader
// on the same file that inproc-hooks writes.
const H = (p) => fileURLToPath(new URL(`../../plugins/cave-context/bin/context-mode/hooks/${p}`, import.meta.url));

// ── helpers ──────────────────────────────────────────────────────────────────

function scratch() {
  return mkdtempSync(join(tmpdir(), "delegate-test-"));
}

// Apply per-test isolation env and clean up afterwards.
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

// ── parity: return shape ──────────────────────────────────────────────────────

test("delegate returns null when CAVE_CONTEXT_NO_UPSTREAM=1", async () => {
  await withEnv({ CAVE_CONTEXT_NO_UPSTREAM: "1" }, async () => {
    const { delegateHook } = await import("../../plugins/cave-context/mcp/delegate.mjs");
    const out = await delegateHook("UserPromptSubmit", { prompt: "x" });
    assert.equal(out, null);
  });
});

test("PostToolUse delegate returns null (no hookSpecificOutput — capture-only event)", async () => {
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, async () => {
    const { delegateHook } = await import("../../plugins/cave-context/mcp/delegate.mjs");
    const input = {
      session_id: "s-ptu-shape",
      cwd: dir,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "git status" },
      tool_response: "On branch main\nnothing to commit",
    };
    const res = await delegateHook("PostToolUse", input);
    // Parity: vendored body writes nothing to stdout → old spawn returned null
    assert.equal(res, null, "PostToolUse must return null (capture-only, no hookSpecificOutput)");
  });
});

test("UserPromptSubmit delegate returns null (capture-only, no hookSpecificOutput)", async () => {
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, async () => {
    const { delegateHook } = await import("../../plugins/cave-context/mcp/delegate.mjs");
    const res = await delegateHook("UserPromptSubmit", {
      session_id: "s-ups-shape",
      cwd: dir,
      prompt: "hello world",
    });
    assert.equal(res, null, "UserPromptSubmit must return null (capture-only, no hookSpecificOutput)");
  });
});

test("PreToolUse stub returns null (Task 4 fills this in)", async () => {
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, async () => {
    const { delegateHook } = await import("../../plugins/cave-context/mcp/delegate.mjs");
    const res = await delegateHook("PreToolUse", { session_id: "s-preu", cwd: dir, tool_name: "Bash" });
    assert.equal(res, null);
  });
});

test("PreCompact stub returns null (Task 4 fills this in)", async () => {
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, async () => {
    const { delegateHook } = await import("../../plugins/cave-context/mcp/delegate.mjs");
    const res = await delegateHook("PreCompact", { session_id: "s-prec", cwd: dir });
    assert.equal(res, null);
  });
});

test("SessionStart returns null when upstream disabled", async () => {
  // SessionStart still uses the spawn path (Task 6 replaces with sessionstart-spawn.mjs).
  // With NO_UPSTREAM the spawn is skipped and null is returned.
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir, CAVE_CONTEXT_NO_UPSTREAM: "1" }, async () => {
    const { delegateHook } = await import("../../plugins/cave-context/mcp/delegate.mjs");
    const res = await delegateHook("SessionStart", { session_id: "s-ss", cwd: dir });
    assert.equal(res, null);
  });
});

test("delegate fails open to null on error (unknown event)", async () => {
  const { delegateHook } = await import("../../plugins/cave-context/mcp/delegate.mjs");
  const out = await delegateHook("NonExistentEvent", {});
  assert.equal(out, null);
});

// ── DB-rows assertion: capture parity ────────────────────────────────────────
// These are the load-bearing tests: a passing shape-only assertion is insufficient —
// if capture is silently broken, session continuity fails. We open the SessionDB on
// the same temp dir after delegateHook returns and assert a row was actually written.

test("PostToolUse in-process capture: DB row written for a capturable tool call", async () => {
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, async () => {
    const { delegateHook } = await import("../../plugins/cave-context/mcp/delegate.mjs");
    const sessionId = "s-db-ptu";
    const input = {
      session_id: sessionId,
      cwd: dir,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      // git status produces 1 extractable event (category "git")
      tool_input: { command: "git status" },
      tool_response: "On branch main\nnothing to commit",
    };
    await delegateHook("PostToolUse", input);

    // Open a fresh reader on the same DB to verify the row exists.
    const { SessionDB } = await import(H("session-db.bundle.mjs"));
    const { getSessionDBPath } = await import(H("session-helpers.mjs"));
    const dbPath = getSessionDBPath();
    const reader = new SessionDB({ dbPath });
    const rollup = reader.getSessionRollup(sessionId);
    reader.close();
    assert.ok(rollup.tool_calls >= 1,
      `expected tool_calls >= 1 after PostToolUse capture, got ${rollup.tool_calls}`);
  });
});

test("UserPromptSubmit in-process capture: DB row written for genuine prompt", async () => {
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, async () => {
    const { delegateHook } = await import("../../plugins/cave-context/mcp/delegate.mjs");
    const sessionId = "s-db-ups";
    await delegateHook("UserPromptSubmit", {
      session_id: sessionId,
      cwd: dir,
      prompt: "please write a hello world script",
    });

    const { SessionDB } = await import(H("session-db.bundle.mjs"));
    const { getSessionDBPath } = await import(H("session-helpers.mjs"));
    const dbPath = getSessionDBPath();
    const reader = new SessionDB({ dbPath });
    const events = reader.getEvents(sessionId, { type: "user_prompt" });
    reader.close();
    assert.ok(events.length >= 1,
      `expected >= 1 user_prompt event in DB, got ${events.length}`);
  });
});

test("PostToolUse system messages are not captured (no DB row for system-generated input)", async () => {
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, async () => {
    const { delegateHook } = await import("../../plugins/cave-context/mcp/delegate.mjs");
    const sessionId = "s-db-sys";
    // UserPromptSubmit with a system-generated message must be skipped
    const res = await delegateHook("UserPromptSubmit", {
      session_id: sessionId,
      cwd: dir,
      prompt: "<system-reminder>some reminder</system-reminder>",
    });
    assert.equal(res, null);
    // No DB file should have been touched for this session
    const { SessionDB } = await import(H("session-db.bundle.mjs"));
    const { getSessionDBPath } = await import(H("session-helpers.mjs"));
    const dbPath = getSessionDBPath();
    const reader = new SessionDB({ dbPath });
    const events = reader.getEvents(sessionId, { type: "user_prompt" });
    reader.close();
    assert.equal(events.length, 0, "system messages must not produce user_prompt rows");
  });
});

test("PostToolUse back-to-back captures do not error (WAL reuse test)", async () => {
  const dir = scratch();
  await withEnv({ CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, async () => {
    const { delegateHook } = await import("../../plugins/cave-context/mcp/delegate.mjs");
    const sessionId = "s-burst";
    const base = { session_id: sessionId, cwd: dir, hook_event_name: "PostToolUse",
      tool_name: "Bash", tool_input: { command: "git status" }, tool_response: "ok" };
    // Fire 3 back-to-back PostToolUse events — all must succeed without lock errors
    await delegateHook("PostToolUse", { ...base, tool_input: { command: "git status" } });
    await delegateHook("PostToolUse", { ...base, tool_input: { command: "git log --oneline -1" } });
    await delegateHook("PostToolUse", { ...base, tool_input: { command: "git diff HEAD" } });

    const { SessionDB } = await import(H("session-db.bundle.mjs"));
    const { getSessionDBPath } = await import(H("session-helpers.mjs"));
    const dbPath = getSessionDBPath();
    const reader = new SessionDB({ dbPath });
    const rollup = reader.getSessionRollup(sessionId);
    reader.close();
    assert.ok(rollup.tool_calls >= 2,
      `expected >= 2 tool_calls after burst, got ${rollup.tool_calls}`);
  });
});
