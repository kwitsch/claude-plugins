#!/usr/bin/env node
// server.mjs — self-contained, zero-dependency MCP stdio server (Node/Bun built-ins only).
// Launched via bin/mjs-launch.sh (bun preferred, node fallback).
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs → stderr.
// Exposes hook_pretooluse and hook_posttooluse tools backed by handlers.mjs.
import process from "node:process";
import readline from "node:readline";

const SERVER_NAME = "js-lsp-hooks";
const SERVER_INFO = { name: SERVER_NAME, version: "1.0.0" };
const DEFAULT_PROTOCOL = "2025-11-25";

startServer();

// Initialize the MCP readline loop: register tools, dispatch JSON-RPC messages, handle stdin close.
function startServer() {
  const HOOK_TOOLS = [
    {
      name: "hook_pretooluse",
      description: "js-lsp PreToolUse enforcement",
      inputSchema: { type: "object", additionalProperties: true },
    },
    {
      name: "hook_posttooluse",
      description: "js-lsp PostToolUse LSP tracker",
      inputSchema: { type: "object", additionalProperties: true },
    },
  ];

  import("./handlers.mjs").then(({ handlePreToolUse, handlePostToolUse }) => {
    const HANDLERS = {
      hook_pretooluse: handlePreToolUse,
      hook_posttooluse: handlePostToolUse,
    };

    const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
    const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
    const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

    const handle = (msg) => {
      const { id, method, params } = msg;
      switch (method) {
        case "initialize":
          return ok(id, {
            protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          });
        case "notifications/initialized":
        case "notifications/cancelled":
          return;
        case "ping":
          return ok(id, {});
        case "tools/list":
          return ok(id, {
            tools: HOOK_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
          });
        case "tools/call": {
          const name = params?.name;
          const fn = HANDLERS[name];
          if (!fn) return fail(id, -32602, `unknown tool: ${name}`);
          if (process.env.MCP_HOOK_DEBUG) {
            process.stderr.write(`[${SERVER_NAME}] tools/call ${name} args=${JSON.stringify(params?.arguments)}\n`);
          }
          let result;
          try {
            result = fn(params?.arguments ?? {});
          } catch (e) {
            return fail(id, -32603, `tool error: ${e?.message ?? e}`);
          }
          return ok(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          });
        }
        default:
          if (id === undefined) return;
          return fail(id, -32601, `method not found: ${method}`);
      }
    };

    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg;
      try { msg = JSON.parse(trimmed); }
      catch { process.stderr.write(`[${SERVER_NAME}] non-JSON line ignored\n`); return; }
      try { handle(msg); }
      catch (e) { process.stderr.write(`[${SERVER_NAME}] handler crash: ${e?.stack ?? e}\n`); }
    });
    rl.on("close", () => process.exit(0));
  }).catch((e) => {
    process.stderr.write(`[${SERVER_NAME}] startup import failed: ${e?.stack ?? e}\n`);
    process.exit(1);
  });
}
