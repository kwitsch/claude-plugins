#!/usr/bin/env node
// userpromptsubmit.mjs — command hook: emit the always-full per-turn caveman
// reminder and delegate context-mode's UserPromptSubmit hook.
// COMMAND (not mcp_tool), and not for an "early-lifecycle" reason: it fires on every
// prompt under a 30s timeout, so a per-prompt MCP round-trip would be a latency/cost
// choice (UserPromptSubmit is `limited` in the event matrix for exactly this). The
// hook no longer parses the prompt or writes state — the level is fixed at full.
import { handleUserPromptSubmit } from "../mcp/handlers.mjs";
let buf = ""; process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", async () => {
  let input = {}; try { input = JSON.parse(buf || "{}"); } catch { /* ignore */ }
  const out = await handleUserPromptSubmit(input);
  if (out && Object.keys(out).length) process.stdout.write(JSON.stringify(out));
});
