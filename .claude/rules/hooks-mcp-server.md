---
paths:
  - "plugins/*/mcp/server.mjs"
  - "plugins/*/.mcp.json"
  - "plugins/*/hooks/hooks.json"
  - "plugins/*/hooks/*.mjs"
---

# Rule: MCP-server hooks (preferred for non-blocking mid-session hooks)

Sources: <https://code.claude.com/docs/en/hooks#mcp-tool-hook-fields> ·
per-event compatibility table: `.claude/rules/hooks-mcp-tool-event-matrix.md`

For a **new** hook, prefer implementing it as a tool on a plugin-local MCP server
and registering the hook with `type: "mcp_tool"` — **for mid-session,
non-blocking hooks**. A command hook is required only in the four cases below; pick
with the decision tree, then confirm the event's row in the
[event matrix](./hooks-mcp-tool-event-matrix.md) (lean on `confidence: documented`
rows only).

## Decision tree

A `command` hook is required when **any** of these hold; otherwise prefer `mcp_tool`.

| Use a **command** hook when…                                                                                                                            | Why                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The event fires **before the server connects** — `SessionStart`, `Setup`                                                                                | `mcp_tool` needs an already-connected server; on first run it is not up yet, so the hook **fails open** (silent no-op). These are the _only_ events with a connectivity problem.                                     |
| You need a **fail-closed hard gate** (must deny / abort)                                                                                                | `mcp_tool` has no exit-2 path and fails open on server-down — it can express only a _soft_ JSON decision, never a guaranteed block. A guard that fails open is a silent security regression.                         |
| The hook is a **fail-open-sensitive side-effect that must reliably fire** — e.g. a state-write that _other_ command hooks read (`ConfigChange`)         | A command hook spawns independently of server liveness; an `mcp_tool` hook would silently skip exactly when the side-effect matters most.                                                                            |
| The event is **latency-sensitive / high-frequency** — `UserPromptSubmit` (30 s timeout), `MessageDisplay` (10 s)                                        | An MCP round-trip on every prompt / streamed line-batch is a latency + cost choice; the shorter timeout also bites. (A hook here that also does a must-run state-write falls under the fail-open-sensitive row too.) |
| **Otherwise: non-blocking, mid-session context injection / observation** — `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SubagentStop`, … | **Prefer `mcp_tool`.** The server is reliably connected mid-session; you reuse a live runtime/deps instead of spawning a process per event.                                                                          |

**Exception — single-hook plugins.** A plugin backing **exactly one** hook may use a
`command` hook instead of standing up an MCP server for it: the server's only real
benefit (avoiding per-event process-spawn latency by staying warm) doesn't amortize
over a single call site the way it does for a plugin with several hooks/tools. Mark
the hook `async: true` when it is read-only / side-effect-free — this removes the
server's latency argument entirely, since the agentic loop no longer waits on either
a server round-trip or a per-event spawn. Leave it synchronous when it mutates state
whose ordering relative to the next tool call matters (the async result only arrives
on the _next_ conversation turn — too late to prevent Claude from acting on stale
state in between). `universal-lint` (async — read-only, exactly one hook) is this
repo's single-hook example.

> Correction note (superseded 2026-08-08, updated for 0.12.0): `universal-format` was previously
> listed here alongside `universal-lint` as a single-hook example. As of 0.9.0 it backed two
> `mcp_tool` hooks, and as of 0.12.0 it backs THREE (`format_pre` PreToolUse + `format_post`
> PostToolUse + `cwd_changed` CwdChanged) on its own plugin-local MCP server, so it no longer
> qualifies for the single-hook exception — the warm in-process prettier library the server keeps
> alive is exactly the "server stays warm" benefit this exception says a single call site can't
> amortize. The `CwdChanged` entry is this repo's first use of that event: it is `limited` in the
> event matrix only because its documented `CLAUDE_ENV_FILE` purpose is unavailable to `mcp_tool`,
> while its use here — a pure side-effect trigger with no decision and no context — is exactly
> what the matrix says works. It carries no `matcher` (silently ignored on that event).

<!-- separate blockquote, not a continuation of the one above -->

> Correction note (added 2026-08-08, updated for 0.11.0): `universal-format` is this repo's ONE
> deliberate exception to "self-contained zero-dep `mcp/server.mjs`". As of 0.11.0 its
> `plugins/universal-format/mcp/server.mjs` is a committed ~9.3 MB `bun build` bundle generated
> from `src/universal-format-mcp/*.ts` with prettier and its `prettier-plugin-java`,
> `@prettier/plugin-php` and `prettier-plugin-sh` plugins inlined, **plus two committed `.wasm`
> sidecars in the same directory** (`web-tree-sitter.wasm`, 201,037 B, and
> `tree-sitter-java_orchard.wasm`, 447,925 B, both git mode `100644`) — copied there by
> `build.mjs` because `new URL(name, import.meta.url)` resolves to the bundle's own directory
> once everything is one file. Rebuild: `pnpm run build:universal-format-mcp`; freshness of the
> bundle AND the sidecars is gated by `test/universal-format/build-artifact.test.mjs` (`src=`,
> `body=`, `plugins=`, `assets=`). The ONE invariant that no longer holds is "a single
> self-contained file": the whole `mcp/` directory is the artifact, and it stays relocatable
> (verified — it runs from a copy with no `node_modules` anywhere above it, under node and bun).
> Every other invariant still holds: an executable `.mjs`, `#!/usr/bin/env node` on line 1, git
> mode `100755`, runs under plain `node`, and no Bun-only API (`Bun.*`, `bun:*`,
> `import.meta.require`) anywhere in the bundle. Do not hand-edit the bundle or the sidecars —
> edit the TS sources and rebuild. Every other plugin's `mcp/server.mjs` stays hand-written and
> dependency-free.

Why the limits (documented Claude Code behavior):

- `mcp_tool` requires an **already-connected** server; the hook never triggers a
  connection flow. Servers connect during/after startup, so only the _pre-connect_
  events (`SessionStart`, `Setup`) genuinely can't rely on it. Mid-session
  lifecycle events (`PreCompact`, `ConfigChange`, `Stop`, `SubagentStop`, …) are
  `full` in the matrix — connectivity is **not** the reason to keep them command
  hooks.
- `mcp_tool` expresses a decision **only via the JSON it returns as tool text** —
  it cannot emit exit code 2. On block-capable events it can do a _soft_ block
  (`permissionDecision: "deny"` / `decision: "block"`), but if the server is down
  it **fails open**. For _hard_ enforcement use a command hook + exit 2.
- Because the failure mode is non-blocking, an `mcp_tool` hook standing in for a
  must-fire side-effect (snapshot, state-write) silently no-ops when the server is
  down. Keep those as command hooks even though the event itself is `full`.

> Correction note (superseded reasoning): an earlier version of this rule grouped
> `SessionEnd`/`UserPromptSubmit`/`PreCompact` with `SessionStart` as
> "early-lifecycle, server not connected." Per the event matrix that is inaccurate —
> only `SessionStart`/`Setup` have the pre-connect problem. `PreCompact` and
> `SessionEnd` are mid/late-session and `full`; `UserPromptSubmit` is limited by
> timeout/latency, not connectivity. Keep `ConfigChange` as a command hook for the
> _fail-open-sensitive side-effect_ reason, not a connectivity one. `PreCompact` is
> no longer a must-stay-command-hook case: it is `full` in the event matrix, so an
> `mcp_tool` hook works mid-session with the server reliably connected. A
> fail-open-sensitive `PreCompact` side-effect (e.g. a resume snapshot) failing
> open when the server is momentarily down at compact time is then an accepted
> trade-off, not an oversight.

## Plugin layout

```
plugins/<name>/
  mcp/server.mjs     # self-contained, zero-dep MCP stdio server (executable .mjs: #!/usr/bin/env node + chmod +x)
  .mcp.json          # registers "example-hooks" with command: "…/mcp/server.mjs" (direct — no wrapper, no args)
  hooks/hooks.json   # { "type": "mcp_tool", "server": "plugin:<plugin-name>:example-hooks", "tool": "<tool>" }
  # bin/mjs-launch.sh  # OPTIONAL bun-preferred launcher (chmod +x) — only if the plugin needs bun runtime selection
```

`server.mjs` is invoked **directly** as the `.mcp.json` `command` — an executable
`.mjs` (`#!/usr/bin/env node`, `100755`), node-only, no runtime-selection wrapper.
(A plugin that genuinely needs bun-preferred selection MAY use the optional
`bin/mjs-launch.sh` wrapper documented at the end of this rule.) The reference
blocks below use the concrete name `example-hooks` so they work as a verbatim copy —
**rename `example-hooks` to your plugin's `<name>-hooks` across `.mcp.json`,
`hooks/hooks.json`, and `server.mjs` (its `SERVER_NAME`).**

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
      "command": "${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"
    }
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` is substituted directly in plugin MCP configs. `mcp/server.mjs`
is what Claude Code exec's — it MUST have the executable bit set (`100755`) and a
`#!/usr/bin/env node` shebang (see the hooks-executable rule), and `node` must be on
the PATH Claude Code launches MCP servers with. The `bin/` PATH feature does not apply
to MCP-server spawning.

## `hooks/hooks.json`

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read|Edit|Write",
        "hooks": [{ "type": "mcp_tool", "server": "plugin:<plugin-name>:example-hooks", "tool": "example_context" }]
      }
    ]
  }
}
```

`mcp_tool` fields: `server` (required — must match a connected server), `tool`
(required). Common fields apply (`if`, `timeout` default 600, `statusMessage`).

## `bin/mjs-launch.sh` (OPTIONAL bun-preferred wrapper — not the default)

This wrapper is an **optional fallback** for a plugin that genuinely needs
bun-preferred runtime selection; the canonical shape is the direct-`.mjs` `command`
shown above. It carries known edge-case issues (empty PATH segment, lingering signal
forwarder); prefer the direct-`.mjs` form. No LSP plugin ships one anymore;
`claude-code-knowledge`, `coding-toolbox`, and `universal-format` use it (their own
PATH line deviates from the template below — appending `~/.local/bin`/`~/.bun/bin`
instead of prepending them, per a correctness finding on
`universal-lint`/`universal-format`'s own rtk/PATH review — see each plugin's
CLAUDE.md). `universal-lint` dropped its MCP server on 2026-07-24 and carries no
wrapper; `universal-format` re-introduced a wrapper-launched MCP server in 0.9.0 (two
hooks on a warm in-process prettier server). Copy the template below if you need it.
Prefers bun; falls back to node; errors if neither is available. All messages go to
stderr (stdout is the MCP stdio channel).

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

`chmod +x` it — it is invoked **directly** as the `.mcp.json` `command`, so it MUST
have the executable bit (`git ls-tree` shows 100755) and a `#!/usr/bin/env node`
shebang. `server.mjs` is a plain Node program — no inline bun re-exec shim. Pure
built-ins; runs identically under node (and under bun if used via the optional wrapper). With
`MCP_HOOK_DEBUG` set, the tool logs each `tools/call` to stderr (handy for
confirming the hook contract). Replace `example-hooks` / the example tool with
your plugin's names.

```js
#!/usr/bin/env node
// Self-contained, zero-dependency MCP stdio server (Node built-ins only).
// Invoked directly as the .mcp.json command (#!/usr/bin/env node; node-only, no wrapper).
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
          process.stderr.write(`[${SERVER_NAME}] tools/call ${params?.name} args=${JSON.stringify(params?.arguments)}\n`);
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
      process.stderr.write(`[${SERVER_NAME}] handler crash: ${e?.stack ?? e}\n`);
    }
  });
  rl.on("close", () => process.exit(0));
}
```

## Gotchas

- **stdout hygiene:** stdio MCP is JSON-RPC over stdout — every diagnostic to stderr.
- **Executable bit + `node` on PATH:** `mcp/server.mjs` is the file Claude Code
  exec's via `.mcp.json` `command` — it MUST be `chmod +x` (`100755` in git,
  enforced by the hooks-executable rule) and carry a `#!/usr/bin/env node` shebang,
  and `node` must be on the PATH Claude Code launches MCP servers with. A
  non-executable / shebang-less server silently fails to start, and the `mcp_tool`
  hook then fails open. `server.mjs` contains no re-exec shim.
- **Optional bun wrapper:** if a plugin uses the optional `bin/mjs-launch.sh`, the
  wrapper (not `server.mjs`) is what Claude Code exec's and must be `chmod +x`; it
  prepends `~/.local/bin` and `~/.bun/bin` to PATH (uses `${HOME}`, never `~`, and
  avoids empty PATH segments), then `exec bun "$@"` if bun is found,
  `exec node "$@"` otherwise. It is not the default — see the caveats above.
- **Debug logging:** the per-`tools/call` stderr log is gated behind
  `MCP_HOOK_DEBUG` so production hooks stay quiet; set it to confirm the contract.
- **Native Windows:** a `#!/usr/bin/env node` server shebang resolves on native
  Windows via the Node launcher; the optional `bin/mjs-launch.sh` wrapper's
  `#!/usr/bin/env bash` shebang would need a shell/`.exe` shim. WSL2 / Linux / macOS
  are fine either way.
- **Direct-`.mjs` is the default:** invoke the executable `.mjs`
  (`#!/usr/bin/env node` + `chmod +x` / `100755`) directly as the `command` — this is
  the canonical shape. The optional `bin/mjs-launch.sh` wrapper is only for plugins that need
  bun-preferred runtime selection. Do not "restore" a wrapper for a plugin that
  intentionally invokes its `.mjs` directly.
