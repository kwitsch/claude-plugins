#!/usr/bin/env node
// sessionstart.mjs — command hook. Via the context-mode CLI it runs session-init
// side-effects + restores prior-session continuity on resume/compact, then emits the
// envelope. It does NOT emit the caveman ruleset — that is emitted by the static
// `cat hooks/SessionStart.md` second SessionStart hook (sole source). COMMAND (not
// mcp_tool): SessionStart is pre-connect.
// Fail-open: a slow/absent/erroring context-mode CLI just yields null continuity.
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

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: continuity,
    },
  }));
});
