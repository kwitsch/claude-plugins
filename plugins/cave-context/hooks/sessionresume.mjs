#!/usr/bin/env node
// sessionresume.mjs — SessionStart command hook, gated to source `resume|compact` by the
// matcher in hooks.json (SessionStart matchers filter on the session source). It delegates
// to the vendored context-mode sessionstart script (via mcp/sessionstart-spawn.mjs) to restore
// prior-session continuity, then emits the envelope. It
// does NOT emit the caveman ruleset — that is emitted by the static `cat hooks/SessionStart.md`
// second SessionStart hook (sole source, matcher-less so it fires on every source). COMMAND
// (not mcp_tool): SessionStart is pre-connect.
// Because the matcher excludes `startup`/`clear`, context-mode's startup-only side-effects
// (CLAUDE.md-capture, old-session GC, session_start lifecycle anchor) are NOT triggered by
// this hook; mid-session capture (PostToolUse/UserPromptSubmit/PreCompact) is unaffected.
// Fail-open: a slow/absent/erroring sessionstart script just yields null continuity → emits {}.
import { delegateHook } from "../mcp/delegate.mjs";
import { extractContinuity } from "../mcp/session-continuity.mjs";

const DELEGATE_TIMEOUT_MS = Number(process.env.CAVE_CONTEXT_SESSIONSTART_TIMEOUT_MS) || 5000;

let buf = "";
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", async () => {
  let input = {};
  try { input = JSON.parse(buf || "{}"); } catch { /* treat as empty envelope */ }

  // Delegate to context-mode: DB session-init / CLAUDE.md-capture / telemetry run
  // upstream; on resume/compact it returns the continuity payload. delegateHook fail-opens
  // to null on timeout / disabled / spawn error.
  let continuity = null;
  try {
    const res = await delegateHook("SessionStart", input, DELEGATE_TIMEOUT_MS);
    const ctxAc = res?.hookSpecificOutput?.additionalContext ?? null;
    if (input.source !== "clear") continuity = extractContinuity(ctxAc); // clear = intentional fresh start
  } catch { /* fail-open */ }

  // Claude Code's SessionStart hook schema requires additionalContext to be a string (or
  // the field omitted) — emitting `additionalContext: null` fails output validation
  // ("(root): Invalid input"). On a fresh start there is no continuity to inject, so emit
  // an empty object `{}` (mirrors mcp/handlers.mjs `emit()`); only attach the envelope when
  // there is actual continuity to restore (resume/compact).
  const out = continuity
    ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: continuity } }
    : {};
  process.stdout.write(JSON.stringify(out));
});
