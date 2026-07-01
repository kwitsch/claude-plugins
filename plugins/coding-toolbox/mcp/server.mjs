#!/usr/bin/env node
// Self-contained, zero-dependency MCP stdio server (Node built-ins only).
// Backs the coding-toolbox PreToolUse golden-rules reminder: throttles the
// reminder to every Nth matched tool call (Edit|Write|NotebookEdit|Bash) instead
// of firing on every call. Invoked directly as the .mcp.json command.
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs → stderr.
import process from "node:process";
import readline from "node:readline";

const SERVER_NAME = "coding-toolbox-hooks"; // keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // only used if client omits protocolVersion
const THROTTLE_EVERY = 10;
const REMINDER_TEXT =
  "Golden rules are active for this session (full text injected at session start). Interaction: user questions go through AskUserQuestion — never plain-text ask-and-wait. Language: compress — drop filler, preserve technical tokens. Behavior: think → simplify → surgical → verify. Mentality: lazy senior dev — YAGNI, reuse before building, prefer deletion, shortest working diff; never cut validation / security / tests.";

let callCount = 0;

startServer();

// Throttled PreToolUse reminder: increments a session-lifetime counter and
// only emits additionalContext on every THROTTLE_EVERYth matched call.
/** @param {ToolHookInput} args @returns {HookResult} */
function reminderHandler(args) {
  callCount += 1;
  if (callCount % THROTTLE_EVERY !== 0) return {}; // no opinion → default flow
  return {
    hookSpecificOutput: {
      hookEventName: args?.hook_event_name ?? "PreToolUse",
      additionalContext: REMINDER_TEXT,
    },
  };
}

// Initialize the MCP stdio server: register tools, start the JSON-RPC readline loop.
function startServer() {
  const TOOLS = [
    {
      name: "golden_rules_reminder",
      description:
        "PreToolUse golden-rules reminder, throttled to every 10th matched call (Edit|Write|NotebookEdit|Bash). Returns additionalContext on the 10th/20th/... call, {} otherwise.",
      inputSchema: { type: "object", additionalProperties: true },
      handler: reminderHandler,
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
