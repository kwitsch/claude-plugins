#!/usr/bin/env node
// sessionstartup.mjs — SessionStart command hook, gated to source `startup` by the matcher
// in hooks.json (SessionStart matchers filter on the session source). It delegates to the
// vendored context-mode sessionstart script (via mcp/sessionstart-spawn.mjs) PURELY to trigger context-mode's startup-only
// side-effects (CLAUDE.md rule-capture, old-session GC, the `session_start` lifecycle
// anchor) and keeps parity with context-mode's session model. It injects NO continuity (a
// fresh start has none) and never passes context-mode's routing block through — the caveman
// ruleset is emitted separately by the static `cat hooks/SessionStart.md` hook — so it
// ALWAYS emits `{}` (never `additionalContext: null`, which fails Claude Code's SessionStart
// output-schema validation). The resume/compact continuity path is the sibling
// hooks/sessionresume.mjs (matched `resume|compact`). COMMAND (not mcp_tool): SessionStart
// is pre-connect. Fail-open: a slow/absent/erroring sessionstart script is a no-op → still {}.
import { delegateHook } from "../mcp/delegate.mjs";

const DELEGATE_TIMEOUT_MS = Number(process.env.CAVE_CONTEXT_SESSIONSTART_TIMEOUT_MS) || 5000;

let buf = "";
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", async () => {
  let input = {};
  try { input = JSON.parse(buf || "{}"); } catch { /* treat as empty envelope */ }

  // Delegate for side-effects only. The CLI branches on input.source; forwarding the
  // SessionStart envelope (source === "startup") runs context-mode's startup branch upstream.
  // The response (context-mode's routing block, no continuity markers) is intentionally
  // discarded — emitting it would double-inject the rules.
  try { await delegateHook("SessionStart", input, DELEGATE_TIMEOUT_MS); } catch { /* fail-open */ }

  process.stdout.write("{}");
});
