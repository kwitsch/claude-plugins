#!/usr/bin/env node
// Self-contained, zero-dependency MCP stdio server (Node built-ins only).
// Invoked directly as the .mcp.json command (#!/usr/bin/env node; node-only, no wrapper).
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs → stderr.
import process from "node:process";
import readline from "node:readline";

const SERVER_NAME = "universal-lint-hooks"; // the server's self-reported name; keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // current stable MCP version; only used if client omits protocolVersion

startServer();

function startServer() {
  const TOOLS = [
    {
      name: "lint_file",
      description:
        "Placeholder PostToolUse hook: inject context after a tool runs. Replaced in a follow-up task.",
      inputSchema: { type: "object", additionalProperties: true },
      handler(args) {
        // TODO(plugin author): replace with real logic. `args` is the hook event JSON.
        return {
          hookSpecificOutput: {
            hookEventName: args?.hook_event_name ?? "PostToolUse",
            additionalContext: `context from ${SERVER_NAME}`,
          },
        };
      },
    },
  ];
  const findTool = (name) => TOOLS.find((t) => t.name === name);
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
  const fail = (id, code, message) =>
    send({ jsonrpc: "2.0", id, error: { code, message } });

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
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stderr.write(`[${SERVER_NAME}] non-JSON line ignored\n`);
      return;
    }
    try {
      handle(msg);
    } catch (e) {
      process.stderr.write(
        `[${SERVER_NAME}] handler crash: ${e?.stack ?? e}\n`,
      );
    }
  });
  rl.on("close", () => process.exit(0));
}
