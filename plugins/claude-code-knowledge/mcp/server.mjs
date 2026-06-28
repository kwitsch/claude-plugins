#!/usr/bin/env node
// Self-contained, zero-dependency MCP stdio server (Node/Bun built-ins only).
// Backs the claude-code-knowledge PreToolUse(Agent|Task) reroute hook: rewrites a
// `claude-code-guide` subagent dispatch to this plugin's `claude-code-expert`.
// Launched via bin/mjs-launch.sh (prefers bun, falls back to node).
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs → stderr.
import process from "node:process";
import readline from "node:readline";

const SERVER_NAME = "claude-code-knowledge-hooks"; // keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // only used if client omits protocolVersion
const REROUTE_TARGET = "claude-code-knowledge:claude-code-expert";

startServer();

// Normalize a subagent_type: lowercase, collapse non-alphanumeric runs to `-`, trim.
/** @param {any} value */
function normalize(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Initialize the MCP stdio server: register tools, start the JSON-RPC readline loop.
function startServer() {
  const TOOLS = [
    {
      name: "reroute_guide",
      description:
        "PreToolUse(Agent|Task) reroute: when subagent_type is claude-code-guide, rewrite it to claude-code-knowledge:claude-code-expert via permissionDecision allow + updatedInput. No-op otherwise.",
      inputSchema: { type: "object", additionalProperties: true },
      /** @param {any} args */
      handler(args) {
        // `args` is the hook event JSON (no `input` mapping in hooks.json).
        const toolInput = (args && args.tool_input) || {};
        if (normalize(toolInput.subagent_type) !== "claude-code-guide") {
          return {}; // no opinion → default flow (fail-open)
        }
        return {
          hookSpecificOutput: {
            hookEventName: args?.hook_event_name ?? "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason:
              "claude-code-knowledge: route Claude Code guide queries to the cc-reference-grounded claude-code-expert agent",
            updatedInput: { ...toolInput, subagent_type: REROUTE_TARGET },
          },
        };
      },
    },
  ];
  const findTool = (/** @type {any} */ name) => TOOLS.find((t) => t.name === name);
  const send = (/** @type {any} */ msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  const ok = (/** @type {any} */ id, /** @type {any} */ result) => send({ jsonrpc: "2.0", id, result });
  const fail = (/** @type {any} */ id, /** @type {any} */ code, /** @type {any} */ message) => send({ jsonrpc: "2.0", id, error: { code, message } });

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
          tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
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
    try { msg = JSON.parse(trimmed); }
    catch { process.stderr.write(`[${SERVER_NAME}] non-JSON line ignored\n`); return; }
    try { handle(msg); }
    catch (e) { const err = /** @type {any} */ (e); process.stderr.write(`[${SERVER_NAME}] handler crash: ${err?.stack ?? err}\n`); }
  });
  rl.on("close", () => process.exit(0));
}
