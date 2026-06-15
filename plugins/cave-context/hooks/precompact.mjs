#!/usr/bin/env node
// precompact.mjs — command hook: delegate context-mode's pre-context-loss snapshot.
// COMMAND (not mcp_tool) because this is a fail-open-sensitive side-effect that must
// fire right before context is compacted away. PreCompact is `full`/mcp_tool-capable
// in the event matrix (mid-session, server connected) — connectivity is NOT the
// reason. But an mcp_tool hook depends on the cave-context server being alive and
// fails open if it isn't, dropping the snapshot exactly when it matters most; this
// command hook spawns the context-mode CLI independently of server liveness.
import { handlePreCompact } from "../mcp/handlers.mjs";
let buf = ""; process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", async () => {
  let input = {}; try { input = JSON.parse(buf || "{}"); } catch { /* ignore */ }
  const out = await handlePreCompact(input);
  if (out && Object.keys(out).length) process.stdout.write(JSON.stringify(out));
});
