#!/usr/bin/env node
// userpromptsubmit.mjs — command hook: detect /caveman level changes, persist the
// level, and emit the per-turn reminder (+ delegate context-mode).
// COMMAND (not mcp_tool) for two reasons, neither of them "early-lifecycle": (1) it
// fires on every prompt under a 30s timeout, so a per-prompt MCP round-trip is a
// latency/cost choice; (2) it performs the /caveman level-toggle state mutation — a
// fail-open-sensitive state-write (same as ConfigChange) that must run reliably every
// prompt, where an mcp_tool hook would silently no-op if the server were down.
import { handleUserPromptSubmit } from "../mcp/handlers.mjs";
let buf = ""; process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", async () => {
  let input = {}; try { input = JSON.parse(buf || "{}"); } catch { /* ignore */ }
  const out = await handleUserPromptSubmit(input);
  if (out && Object.keys(out).length) process.stdout.write(JSON.stringify(out));
});
