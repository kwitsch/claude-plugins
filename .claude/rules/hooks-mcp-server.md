---
paths:
  - "plugins/*/mcp/server.mjs"
  - "plugins/*/.mcp.json"
  - "plugins/*/hooks/hooks.json"
  - "plugins/*/hooks/*.mjs"
---

# Rule: MCP-server hooks (preferred for non-blocking mid-session hooks)

Sources: https://code.claude.com/docs/en/hooks#mcp-tool-hook-fields ·
per-event compatibility table: `.claude/rules/hooks-mcp-tool-event-matrix.md`

For a **new** hook, prefer implementing it as a tool on a plugin-local MCP server
and registering the hook with `type: "mcp_tool"` — **for mid-session,
non-blocking hooks**. A command hook is required only in the four cases below; pick
with the decision tree, then confirm the event's row in the
[event matrix](./hooks-mcp-tool-event-matrix.md) (lean on `confidence: documented`
rows only).

## Decision tree

A `command` hook is required when **any** of these hold; otherwise prefer `mcp_tool`.

| Use a **command** hook when… | Why |
|---|---|
| The event fires **before the server connects** — `SessionStart`, `Setup` | `mcp_tool` needs an already-connected server; on first run it is not up yet, so the hook **fails open** (silent no-op). These are the *only* events with a connectivity problem. |
| You need a **fail-closed hard gate** (must deny / abort) | `mcp_tool` has no exit-2 path and fails open on server-down — it can express only a *soft* JSON decision, never a guaranteed block. A guard that fails open is a silent security regression. |
| The hook is a **fail-open-sensitive side-effect that must reliably fire** — e.g. a state-write that *other* command hooks read (`ConfigChange`) | A command hook spawns independently of server liveness; an `mcp_tool` hook would silently skip exactly when the side-effect matters most. |
| The event is **latency-sensitive / high-frequency** — `UserPromptSubmit` (30 s timeout), `MessageDisplay` (10 s) | An MCP round-trip on every prompt / streamed line-batch is a latency + cost choice; the shorter timeout also bites. (A hook here that also does a must-run state-write falls under the fail-open-sensitive row too.) |
| **Otherwise: non-blocking, mid-session context injection / observation** — `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SubagentStop`, … | **Prefer `mcp_tool`.** The server is reliably connected mid-session; you reuse a live runtime/deps instead of spawning a process per event. |

Why the limits (documented Claude Code behavior):
- `mcp_tool` requires an **already-connected** server; the hook never triggers a
  connection flow. Servers connect during/after startup, so only the *pre-connect*
  events (`SessionStart`, `Setup`) genuinely can't rely on it. Mid-session
  lifecycle events (`PreCompact`, `ConfigChange`, `Stop`, `SubagentStop`, …) are
  `full` in the matrix — connectivity is **not** the reason to keep them command
  hooks.
- `mcp_tool` expresses a decision **only via the JSON it returns as tool text** —
  it cannot emit exit code 2. On block-capable events it can do a *soft* block
  (`permissionDecision: "deny"` / `decision: "block"`), but if the server is down
  it **fails open**. For *hard* enforcement use a command hook + exit 2.
- Because the failure mode is non-blocking, an `mcp_tool` hook standing in for a
  must-fire side-effect (snapshot, state-write) silently no-ops when the server is
  down. Keep those as command hooks even though the event itself is `full`.

> Correction note (superseded reasoning): an earlier version of this rule grouped
> `SessionEnd`/`UserPromptSubmit`/`PreCompact` with `SessionStart` as
> "early-lifecycle, server not connected." Per the event matrix that is inaccurate —
> only `SessionStart`/`Setup` have the pre-connect problem. `PreCompact` and
> `SessionEnd` are mid/late-session and `full`; `UserPromptSubmit` is limited by
> timeout/latency, not connectivity. Keep `ConfigChange` as a command hook for the
> *fail-open-sensitive side-effect* reason, not a connectivity one. `PreCompact` is
> no longer a must-stay-command-hook case: cave-context now runs it as an `mcp_tool`
> hook (`hook_precompact`) mid-session, with the server reliably connected — the
> delegated context-mode resume snapshot is **best-effort** and fails open if the
> server is momentarily down at compact time, which is an accepted trade-off.

## Plugin layout

```
plugins/<name>/
  bin/mjs-launch.sh  # bun-preferred .mjs launcher (chmod +x)
  mcp/server.mjs     # self-contained, zero-dep MCP stdio server (chmod +x)
  .mcp.json          # registers "example-hooks" via bin/mjs-launch.sh with args: ["…/mcp/server.mjs"]
  hooks/hooks.json   # { "type": "mcp_tool", "server": "plugin:<plugin-name>:example-hooks", "tool": "<tool>" }
```

Runtime selection is owned by `bin/mjs-launch.sh` (bun-preferred, node fallback);
`server.mjs` is a plain Node/Bun program. The three reference blocks below use the
concrete name `example-hooks` so they work as a verbatim copy — **rename
`example-hooks` to your plugin's `<name>-hooks` across all three files.**

**`server` value in `hooks.json` — use the runtime-namespaced name, NOT the bare
`.mcp.json` key.** A plugin's MCP server connects under
`plugin:<plugin-name>:<server-key>` (verify with `claude mcp list` / `/mcp` — e.g.
`plugin:context7:context7`). An `mcp_tool` hook's `server` field is matched against
that connected name, so a plugin's own hook MUST reference
`plugin:<plugin-name>:<server-key>`; the bare `.mcp.json` key resolves to
`MCP server '<key>' not connected` on every fire. The `.mcp.json` server key and
the server's self-reported `SERVER_NAME` stay the bare `<name>-hooks`; only the
hook's `server` reference is namespaced. (Bare-key matching only works for
non-plugin servers defined directly in settings.)

## `.mcp.json`

```json
{
  "mcpServers": {
    "example-hooks": {
      "command": "${CLAUDE_PLUGIN_ROOT}/bin/mjs-launch.sh",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]
    }
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` is substituted directly in plugin MCP configs. The wrapper
`bin/mjs-launch.sh` is what Claude Code exec's — it MUST have the executable bit set
(see the hooks-executable rule). `server.mjs` is passed as an argument, not exec'd
directly. The `bin/` PATH feature does not apply to MCP-server spawning.

## `hooks/hooks.json`

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read|Edit|Write",
        "hooks": [
          { "type": "mcp_tool", "server": "plugin:<plugin-name>:example-hooks", "tool": "example_context" }
        ]
      }
    ]
  }
}
```

`mcp_tool` fields: `server` (required — must match a connected server), `tool`
(required). Common fields apply (`if`, `timeout` default 600, `statusMessage`).

## `bin/mjs-launch.sh` (canonical wrapper — copy verbatim, `chmod +x`)

Runtime selection is owned by this wrapper. Copy it from any plugin that has one
(e.g. `plugins/js-lsp/bin/mjs-launch.sh`). Prefers bun; falls back to node; errors
if neither is available. All messages go to stderr (stdout is the MCP stdio channel).

```bash
#!/usr/bin/env bash
# mjs-launch.sh — runtime launcher for this plugin's local .mjs program(s).
# Prefers bun; falls back to node; errors if neither is available.
# stdout MUST stay clean (stdio MCP channel); all messages → stderr.
# Non-interactive PATH often lacks ~/.local/bin and ~/.bun/bin; prepend them.
# Use ${HOME}, never ~. No empty PATH segment.
set -euo pipefail
export PATH="${HOME:-}/.local/bin:${HOME:-}/.bun/bin${PATH:+:${PATH}}"

if [ "$#" -eq 0 ]; then
  echo "mjs-launch.sh: missing argument (expected a .mjs script path)" >&2
  exit 64
fi

if command -v bun  >/dev/null 2>&1; then exec bun  "$@"; fi
if command -v node >/dev/null 2>&1; then exec node "$@"; fi
echo "mjs-launch.sh: neither bun nor node is available. Install Node.js or Bun." >&2
exit 1
```

## `mcp/server.mjs` (reference, self-contained, zero-dep)

`chmod +x` it (the file still needs the executable bit in case it is ever invoked
directly, and `git ls-tree` will show 100755). Runtime selection is handled by
`bin/mjs-launch.sh`; `server.mjs` is a plain Node/Bun program — no inline bun
re-exec shim. Pure built-ins; identical protocol under bun and node. With
`MCP_HOOK_DEBUG` set, the tool logs each `tools/call` to stderr (handy for
confirming the hook contract). Replace `example-hooks` / the example tool with
your plugin's names.

```js
#!/usr/bin/env node
// Self-contained, zero-dependency MCP stdio server (Node/Bun built-ins only).
// Runtime selection (bun-preferred, node fallback) is owned by bin/mjs-launch.sh.
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs → stderr.
import process from "node:process";
import readline from "node:readline";

const SERVER_NAME = "example-hooks"; // the server's self-reported name; keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // current stable MCP version; only used if client omits protocolVersion

startServer();

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
- **bun preference + node fallback:** `bin/mjs-launch.sh` owns runtime selection —
  it prepends `~/.local/bin` and `~/.bun/bin` to PATH (non-interactive shells often
  miss these; uses `${HOME}`, never `~`, and avoids empty PATH segments), then
  `exec bun "$@"` if bun is found, `exec node "$@"` otherwise, and errors if
  neither is available. `server.mjs` itself contains no re-exec shim.
- **Executable bit:** `bin/mjs-launch.sh` is the file Claude Code exec's via
  `.mcp.json` `command` — it MUST be `chmod +x` (enforced by the hooks-executable
  rule). `server.mjs` keeps its executable bit too (`100755` in git) so it can be
  invoked directly in development, but the MCP-server path goes through the wrapper.
  A non-executable wrapper silently fails to start, and the `mcp_tool` hook then
  fails open.
- **Debug logging:** the per-`tools/call` stderr log is gated behind
  `MCP_HOOK_DEBUG` so production hooks stay quiet; set it to confirm the contract.
- **Native Windows:** the `#!/usr/bin/env bash` shebang in `bin/mjs-launch.sh`
  needs a shell/`.exe` shim on native Windows; WSL2 / Linux / macOS are fine.
