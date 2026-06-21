#!/usr/bin/env node
// Self-contained, zero-dependency MCP stdio server (Node/Bun built-ins only).
// Started via #!/usr/bin/env node, it re-execs under bun when available (TS_LSP_NO_BUN=1 bypasses).
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs → stderr.
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const SERVER_NAME = "ts-lsp-hooks";
const SERVER_INFO = { name: SERVER_NAME, version: "1.0.0" };
const DEFAULT_PROTOCOL = "2025-11-25";

// Prefer bun, fall back to node. Under bun, process.versions.bun is set → no loop.
// TS_LSP_NO_BUN=1 skips re-exec (used by smoke tests for determinism).
if (process.versions.bun || process.env.TS_LSP_NO_BUN === "1") {
  startServer();
} else {
  const env = { ...process.env };
  const home = process.env.HOME;
  if (home) {
    // Avoid a trailing ':' (an empty PATH segment resolves to CWD — a code-exec
    // risk in an untrusted workspace) when env.PATH is unset (CodeRabbit CR2).
    const inherited = env.PATH ? `:${env.PATH}` : "";
    env.PATH = `${home}/.bun/bin:${home}/.local/bin${inherited}`;
  }
  let spawned = false;
  const child = spawn("bun", [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env,
  });
  const forwarders = new Map();
  child.once("spawn", () => {
    spawned = true;
    for (const s of ["SIGTERM", "SIGINT", "SIGHUP"]) {
      const h = () => child.kill(s);
      forwarders.set(s, h);
      process.on(s, h);
    }
  });
  child.once("error", () => { if (!spawned) startServer(); }); // bun missing (ENOENT) → node
  child.once("exit", (code, sig) => {
    if (!spawned) return;
    // Remove our signal forwarders before re-raising, so the re-raised signal
    // performs default termination instead of re-invoking the (now stale)
    // handler — otherwise the parent lingers (CodeRabbit CR3).
    for (const [s, h] of forwarders) process.removeListener(s, h);
    if (sig) process.kill(process.pid, sig);
    else process.exit(code ?? 0);
  });
}

function startServer() {
  const HOOK_TOOLS = [
    {
      name: "hook_pretooluse",
      description: "ts-lsp PreToolUse enforcement",
      inputSchema: { type: "object", additionalProperties: true },
    },
    {
      name: "hook_posttooluse",
      description: "ts-lsp PostToolUse LSP tracker",
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
