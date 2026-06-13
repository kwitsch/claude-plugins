#!/usr/bin/env node
import { handlePreToolUse } from "../mcp/handlers.mjs";
let buf = ""; process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", async () => {
  let input = {}; try { input = JSON.parse(buf || "{}"); } catch { /* ignore */ }
  const out = await handlePreToolUse(input);
  if (out && Object.keys(out).length) process.stdout.write(JSON.stringify(out));
});
