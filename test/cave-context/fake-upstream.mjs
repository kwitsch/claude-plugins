#!/usr/bin/env node
// Minimal stdio MCP server: initialize, tools/list (one tool), tools/call (echo).
import readline from "node:readline";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "fake-upstream", version: "0" } } });
  // ctx_echo is the real proxy target; ctx_stats/ctx_doctor/ctx_upgrade are listed so the
  // server's DENIED_UPSTREAM_TOOLS filter (tools/list strip + tools/call reject) is exercised.
  else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
    { name: "ctx_echo", description: "echo", inputSchema: { type: "object", additionalProperties: true } },
    { name: "ctx_stats", description: "stats", inputSchema: { type: "object", additionalProperties: true } },
    { name: "ctx_doctor", description: "doctor", inputSchema: { type: "object", additionalProperties: true } },
    { name: "ctx_upgrade", description: "upgrade", inputSchema: { type: "object", additionalProperties: true } },
  ] } });
  else if (msg.method === "tools/call" && msg.params?.name === "ctx_crash") process.exit(1); // sentinel: simulate a mid-session crash
  else if (msg.method === "tools/call") send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "echo:" + JSON.stringify(msg.params?.arguments ?? {}) }] } });
  else if (msg.id != null) send({ jsonrpc: "2.0", id: msg.id, result: {} });
});
