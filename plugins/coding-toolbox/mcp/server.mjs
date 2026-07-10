#!/usr/bin/env node
// Self-contained, zero-dependency MCP stdio server (Node built-ins only).
// Backs the coding-toolbox Stop-hook mechanical gate for the Interaction axis
// (interaction_gate). Invoked directly as the .mcp.json command.
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs → stderr.
import process from "node:process";
import readline from "node:readline";

const SERVER_NAME = "coding-toolbox-hooks"; // keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // only used if client omits protocolVersion

// Matches a final non-empty line ending in "?" outside fenced code blocks —
// the Interaction axis's "never a bare question to the user" anti-pattern.
const BARE_QUESTION_RE = /\?\s*$/;

startServer();

// Stop mechanical gate for the Interaction axis: `last_assistant_message` is
// the documented Stop-hook field carrying Claude's final response text, so no
// transcript parsing is needed. If the last non-empty line outside fenced
// code blocks ends in "?", block the stop and tell Claude to redo it via
// AskUserQuestion. Loop safety is the platform's (stop_hook_active input +
// 8-consecutive-block cap) — no extra guard needed here.
/** @param {StopHookInput} args @returns {HookResult} */
function interactionGateHandler(args) {
  const withoutFences = String(args?.last_assistant_message ?? "").replace(/```[\s\S]*?```/g, "");
  const lines = withoutFences.split("\n").map((l) => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? "";
  if (!BARE_QUESTION_RE.test(lastLine)) return {}; // no opinion → allow stop
  return {
    decision: "block",
    reason:
      "Interaction rule violation: the final response ends with a plain-text question to the user. Route it through the AskUserQuestion tool instead — no exceptions, not even a casual yes/no offer.",
  };
}

// Initialize the MCP stdio server: register tools, start the JSON-RPC readline loop.
function startServer() {
  const TOOLS = [
    {
      name: "interaction_gate",
      description:
        "Stop mechanical gate for the Interaction axis: blocks (decision:block+reason) when last_assistant_message ends in a bare '?' outside code fences, telling Claude to redo it via AskUserQuestion. {} otherwise.",
      inputSchema: { type: "object", additionalProperties: true },
      handler: interactionGateHandler,
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
