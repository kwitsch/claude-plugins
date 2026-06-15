#!/usr/bin/env node
// Self-contained, zero-dependency MCP stdio server (Node/Bun built-ins only).
// Runtime selection (bun-preferred, node fallback) is owned by bin/bnx.sh, which
// launches this module; there is no in-file re-exec shim.
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs → stderr.
import process from "node:process";
import readline from "node:readline";

const SERVER_NAME = "cave-context";
const SERVER_INFO = { name: SERVER_NAME, version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-11-25";

startServer();

function startServer() {
  const HOOK_TOOLS = [
    { name: "hook_userpromptsubmit", description: "Aggregated UserPromptSubmit hook (caveman + context-mode).", inputSchema: { type: "object", additionalProperties: true } },
    { name: "hook_pretooluse", description: "Aggregated PreToolUse hook (context-mode routing).", inputSchema: { type: "object", additionalProperties: true } },
    { name: "hook_posttooluse", description: "Aggregated PostToolUse hook (context-mode capture).", inputSchema: { type: "object", additionalProperties: true } },
    { name: "hook_precompact", description: "Aggregated PreCompact hook (context-mode snapshot).", inputSchema: { type: "object", additionalProperties: true } },
  ];

  // Lazy imports — keep shim path dependency-free until we actually serve.
  Promise.all([import("./proxy.mjs"), import("./handlers.mjs")]).then(([{ Upstream }, { HANDLERS }]) => {
    const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
    const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
    const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

    const up = new Upstream();
    let upStarted = null; // promise of tools[]
    const ensureUp = () => {
      if (upStarted && !up.alive) upStarted = null; // child died → re-spawn on next call
      if (!upStarted) upStarted = up.start().catch(() => []);
      return upStarted;
    };

    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg;
      try { msg = JSON.parse(trimmed); }
      catch { process.stderr.write(`[${SERVER_NAME}] non-JSON line ignored\n`); return; }
      const { id, method, params } = msg;
      try {
        if (method === "initialize") {
          ensureUp(); // begin upstream startup in background
          return ok(id, { protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
        }
        if (method === "notifications/initialized" || method === "notifications/cancelled") return;
        if (method === "ping") return ok(id, {});
        if (method === "tools/list") {
          const upstreamTools = await ensureUp();
          return ok(id, { tools: [...upstreamTools, ...HOOK_TOOLS] });
        }
        if (method === "tools/call") {
          const name = params?.name;
          if (HANDLERS[name]) {
            if (process.env.MCP_HOOK_DEBUG) process.stderr.write(`[${SERVER_NAME}] hook tool: ${name}\n`);
            const result = await HANDLERS[name](params?.arguments ?? {});
            return ok(id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
          }
          const upTools = await ensureUp();
          if (!upTools.length) return fail(id, -32603, "upstream context-mode server unavailable");
          const result = await up.callTool(name, params?.arguments ?? {});
          return ok(id, result);
        }
        if (id != null) return fail(id, -32601, `method not found: ${method}`);
      } catch (e) {
        process.stderr.write(`[${SERVER_NAME}] handler crash: ${e?.stack ?? e}\n`);
        if (id != null) fail(id, -32603, String(e?.message ?? e));
      }
    });
    rl.on("close", () => { up.stop(); process.exit(0); });
  }).catch((e) => {
    // The stdin reader lives inside .then; a failed startup import would otherwise leave
    // the process alive-but-unresponsive (or crash unlabelled). Fail loudly and cleanly.
    process.stderr.write(`[${SERVER_NAME}] startup import failed: ${e?.stack ?? e}\n`);
    process.exit(1);
  });
}
