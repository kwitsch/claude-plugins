#!/usr/bin/env node
// Minimal stdio MCP upstream that exposes ctx_index and APPENDS each ctx_index call's
// arguments (one JSON line) to the file named by CC_REC_FILE — lets an out-of-process
// test observe the server's fire-and-forget re-index dispatch.
import readline from "node:readline";
import { appendFileSync } from "node:fs";
const REC = process.env.CC_REC_FILE;
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "fake-rec", version: "0" } } });
  else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "ctx_index", description: "index", inputSchema: { type: "object", additionalProperties: true } }] } });
  else if (msg.method === "tools/call") {
    if (msg.params?.name === "ctx_index" && REC) { try { appendFileSync(REC, JSON.stringify(msg.params.arguments) + "\n"); } catch { /* ignore */ } }
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok" }] } });
  } else if (msg.id != null) send({ jsonrpc: "2.0", id: msg.id, result: {} });
});
