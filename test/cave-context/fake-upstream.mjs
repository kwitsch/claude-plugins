#!/usr/bin/env node
// Minimal stdio MCP server: initialize, tools/list (one tool), tools/call (echo).
import readline from "node:readline";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "fake-upstream", version: "0" } } });
  else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "ctx_echo", description: "echo", inputSchema: { type: "object", additionalProperties: true } }] } });
  else if (msg.method === "tools/call") send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "echo:" + JSON.stringify(msg.params?.arguments ?? {}) }] } });
  else if (msg.id != null) send({ jsonrpc: "2.0", id: msg.id, result: {} });
});
