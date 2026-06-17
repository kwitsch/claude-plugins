#!/usr/bin/env node
// sessionstart.mjs — command hook. Emits cave-context's condensed caveman ruleset, and
// (via the context-mode CLI) runs session-init side-effects + restores prior-session
// continuity on resume/compact. COMMAND (not mcp_tool): SessionStart is pre-connect.
// Fail-open: a slow/absent/erroring context-mode CLI still yields the condensed block.
import { sessionStartPrompt } from "../mcp/sessionprompt.mjs";
import { delegateHook } from "../mcp/delegate.mjs";
import { extractContinuity } from "../mcp/session-continuity.mjs";
import { mergeContext } from "../mcp/handlers.mjs";
import { healCache } from "../mcp/cache-heal.mjs";

const DELEGATE_TIMEOUT_MS = Number(process.env.CAVE_CONTEXT_SESSIONSTART_TIMEOUT_MS) || 5000;

let buf = "";
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", async () => {
  let input = {};
  try { input = JSON.parse(buf || "{}"); } catch { /* treat as empty envelope */ }

  const condensed = sessionStartPrompt();

  // Delegate to context-mode: DB session-init / CLAUDE.md-capture / heal / telemetry run
  // upstream; on resume/compact it returns the continuity payload. delegateHook fail-opens
  // to null on timeout / disabled / spawn error.
  let continuity = null;
  try {
    const res = await delegateHook("SessionStart", input, DELEGATE_TIMEOUT_MS);
    const ctxAc = res?.hookSpecificOutput?.additionalContext ?? null;
    if (input.source !== "clear") continuity = extractContinuity(ctxAc); // clear = intentional fresh start
  } catch { /* fail-open */ }

  // Native self-heal/GC for cave-context's OWN versioned cache.
  try { healCache(process.env.CLAUDE_PLUGIN_ROOT); } catch { /* best-effort */ }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: mergeContext(condensed, continuity),
    },
  }));
});
