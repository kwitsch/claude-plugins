#!/usr/bin/env node
// mcp/server.mjs — universal-format plugin: PostToolUse Write|Edit auto-formatter.
// Self-contained, zero-dependency MCP stdio server (Node built-ins only).
// Invoked directly as the .mcp.json command (#!/usr/bin/env node; node-only, no wrapper).
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs -> stderr.
// SCAFFOLD STUB: the format_file tool is wired but is a silent no-op ({});
// the real formatter dispatch lands in a later change.
import process from "node:process";
import readline from "node:readline";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SERVER_NAME = "universal-format-hooks"; // keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // only used if client omits protocolVersion

// True only when this file is the process entry point (MCP spawn / `node server.mjs`),
// false when imported by a unit test — so importing never starts the stdin loop.
function isMainModule() {
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

// Silent no-op placeholder; replaced with the real formatter dispatch in Task 2.
/** @param {any} _args @returns {HookResult} */
function formatFileHandler(_args) {
  return {};
}

function startServer() {
  const TOOLS = [
    {
      name: "format_file",
      description:
        "PostToolUse Write|Edit auto-formatter: formats the just-written file with the language's standard formatter when installed. Returns additionalContext when the file changed, {} otherwise.",
      inputSchema: { type: "object", additionalProperties: true },
      handler: formatFileHandler,
    },
  ];
  const findTool = (/** @type {any} */ name) =>
    TOOLS.find((t) => t.name === name);
  const send = (/** @type {any} */ msg) =>
    process.stdout.write(JSON.stringify(msg) + "\n");
  const ok = (/** @type {any} */ id, /** @type {any} */ result) =>
    send({ jsonrpc: "2.0", id, result });
  const fail = (
    /** @type {any} */ id,
    /** @type {any} */ code,
    /** @type {any} */ message,
  ) => send({ jsonrpc: "2.0", id, error: { code, message } });

  const handle = (/** @type {any} */ msg) => {
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
          tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
      case "tools/call": {
        const tool = findTool(params?.name);
        if (!tool) return fail(id, -32602, `unknown tool: ${params?.name}`);
        if (process.env.MCP_HOOK_DEBUG) {
          process.stderr.write(
            `[${SERVER_NAME}] tools/call ${params?.name} args=${JSON.stringify(params?.arguments)}\n`,
          );
        }
        let result;
        try {
          result = tool.handler(params?.arguments ?? {});
        } catch (e) {
          const err = /** @type {any} */ (e);
          return fail(id, -32603, `tool error: ${err?.message ?? err}`);
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
  rl.on("line", (/** @type {any} */ line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stderr.write(`[${SERVER_NAME}] non-JSON line ignored\n`);
      return;
    }
    try {
      handle(msg);
    } catch (e) {
      const err = /** @type {any} */ (e);
      process.stderr.write(
        `[${SERVER_NAME}] handler crash: ${err?.stack ?? err}\n`,
      );
    }
  });
  rl.on("close", () => process.exit(0));
}

if (isMainModule()) startServer();
