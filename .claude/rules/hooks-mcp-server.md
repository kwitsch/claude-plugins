---
paths:
  - "plugins/*/mcp/server.mjs"
  - "plugins/*/.mcp.json"
---

# Rule: MCP-server hooks (preferred for non-blocking mid-loop hooks)

Source: https://code.claude.com/docs/en/hooks#mcp-tool-hook-fields

For a **new** hook, prefer implementing it as a tool on a plugin-local MCP server
and registering the hook with `type: "mcp_tool"` — **but only for non-blocking,
mid-loop hooks**. Use the decision tree.

## Decision tree

| Hook need | Implementation |
|---|---|
| Early-lifecycle (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreCompact`) | command hook (`.mjs`) — the server is not reliably connected that early |
| Must block / deny — a fail-closed guard | command hook (`.mjs`) — `mcp_tool` no-ops silently if the server is down |
| **Non-blocking, mid-loop** (`PreToolUse` / `PostToolUse`): inject context, observe, needs a real runtime/deps | **MCP-server hook** (`mcp_tool`) — preferred |

Why the limits (documented Claude Code behavior):
- `mcp_tool` requires an **already-connected** server; the hook never triggers a
  connection flow. MCP servers connect during/after startup, so early-lifecycle
  hooks can't rely on it (the type is technically permitted on `SessionStart`,
  but the server may not be up).
- If the server is not connected (startup race, no runtime, crash), the
  `mcp_tool` hook **fails open** (silent no-op). A guard that fails open is a
  silent security regression — guards stay command hooks.

## Plugin layout

```
plugins/<name>/
  mcp/server.mjs     # self-contained, zero-dep MCP stdio server (chmod +x)
  .mcp.json          # registers "example-hooks" -> ${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs
  hooks/hooks.json   # { "type": "mcp_tool", "server": "example-hooks", "tool": "<tool>" }
```

No `bin/` directory and no wrapper script — the server file holds everything:
runtime selection, the MCP protocol, and the hook logic. The three reference
blocks below use the concrete name `example-hooks` so they work as a verbatim
copy — **rename `example-hooks` to your plugin's `<name>-hooks` across all
three files.** The `server` value in `hooks.json` must equal the server key in
`.mcp.json` (that is how the `mcp_tool` hook is wired to the server).

## `.mcp.json`

```json
{
  "mcpServers": {
    "example-hooks": {
      "command": "${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"
    }
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` is substituted directly in plugin MCP configs. The server
`.mjs` is run directly via its shebang, so it MUST have the executable bit set
(see the hooks-executable rule). The `bin/` PATH feature does not apply to
MCP-server spawning.

## `hooks/hooks.json`

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read|Edit|Write",
        "hooks": [
          { "type": "mcp_tool", "server": "example-hooks", "tool": "example_context" }
        ]
      }
    ]
  }
}
```

`mcp_tool` fields: `server` (required — must match a connected server), `tool`
(required). Common fields apply (`if`, `timeout` default 600, `statusMessage`).

## `mcp/server.mjs` (reference, self-contained, zero-dep)

`chmod +x` it. Pure built-ins; identical protocol under bun and node. With
`MCP_HOOK_DEBUG` set, the tool logs each `tools/call` to stderr (handy for
confirming the hook contract). Replace `example-hooks` / the example tool with
your plugin's names.

```js
#!/usr/bin/env node
// Self-contained, zero-dependency MCP stdio server (Node/Bun built-ins only).
// Started via #!/usr/bin/env node, it re-execs under bun when available.
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs → stderr.
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const SERVER_NAME = "example-hooks"; // the server's self-reported name; keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // current stable MCP version; only used if client omits protocolVersion

// Prefer bun, fall back to node. Under bun, process.versions.bun is set → no loop.
if (process.versions.bun) {
  startServer();
} else {
  const env = { ...process.env };
  const home = process.env.HOME; // non-interactive PATH often lacks ~/.bun/bin
  if (home) env.PATH = `${home}/.bun/bin:${home}/.local/bin:${env.PATH ?? ""}`;
  let spawned = false;
  const child = spawn("bun", [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env,
  });
  child.once("spawn", () => {
    spawned = true;
    // node has no exec(): forward signals so bun is never orphaned.
    for (const s of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(s, () => child.kill(s));
  });
  // Node may fire BOTH 'error' and 'exit' — guard with `spawned`.
  child.once("error", () => { if (!spawned) startServer(); }); // bun missing (ENOENT) → node
  child.once("exit", (code, sig) => {
    if (!spawned) return;
    sig ? process.kill(process.pid, sig) : process.exit(code ?? 0);
  });
}

function startServer() {
  const TOOLS = [
    {
      name: "example_context",
      description: "Example PostToolUse hook: inject context after a tool runs.",
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
}
```

## Gotchas

- **stdout hygiene:** stdio MCP is JSON-RPC over stdout — every diagnostic to stderr.
- **bun preference + node fallback:** node has no true `exec()`, so the bun
  re-exec uses async `spawn` with `stdio: "inherit"`, forwards shutdown signals
  (so bun is never orphaned), and propagates the child's exit. A `spawned` flag
  (set on the `spawn` event) guards both handlers — Node may fire **both**
  `error` and `exit`, so without it the shim could start the node server *and
  then* kill it. Signal listeners are installed only on `spawn` so the
  ENOENT→node fallback stays clean.
- **PATH + `$HOME` guard:** non-interactive spawns often lack `~/.bun/bin`; the
  shim prepends it (guarded on `$HOME`). Use `$HOME`, never `~`.
- **No re-exec loop:** under bun, `process.versions.bun` is set, so the shim runs
  the server directly.
- **Executable bit:** the server is spawned directly via its shebang — it MUST be
  `chmod +x` (enforced by the hooks-executable rule). A non-executable server
  silently fails to start, and the `mcp_tool` hook then fails open.
- **Debug logging:** the per-`tools/call` stderr log is gated behind
  `MCP_HOOK_DEBUG` so production hooks stay quiet; set it to confirm the contract.
- **Registration fallback:** if the direct shebang form does not connect (depends
  on the executable bit + Claude Code exec'ing a script directly), register the
  runtime explicitly instead — still wrapper-free, still re-execs to bun via the
  shim: `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]`.
- **Native Windows:** the `#!/usr/bin/env node` shebang and the `spawn("bun", …)`
  path need a shell/`.exe` shim there; WSL2 / Linux / macOS are fine. Future: a
  compiled launcher or configure-time runtime detection.
