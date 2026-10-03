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
· copy-paste templates: `.claude/skills/create-plugin/templates/` (`mcp-server.mjs.tmpl`, `mjs-launch.sh.tmpl`)

For a **new** hook, prefer implementing it as a tool on a plugin-local MCP server
and registering the hook with `type: "mcp_tool"` — **for mid-session,
non-blocking hooks**. A command hook is required only in the four cases below; pick
with the decision tree, then confirm the event's row in the
[event matrix](./hooks-mcp-tool-event-matrix.md) (lean on `confidence: documented`
rows only). New or rewritten command hooks are Node ES modules (`.mjs`), not shell
scripts; existing `.sh` hooks stay until rewritten.

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

`universal-format` is the one deliberate exception to the self-contained zero-dep
`mcp/server.mjs` shape (a committed `bun build` bundle plus committed `.wasm` sidecars)
— see `plugins/universal-format/CLAUDE.md`.

Why the limits (documented Claude Code behavior):

- `mcp_tool` requires an **already-connected** server; the hook never triggers a
  connection flow. Servers connect during/after startup, so only the _pre-connect_
  events (`SessionStart`, `Setup`) genuinely can't rely on it. Mid-session
  lifecycle events (`PreCompact`, `ConfigChange`, `Stop`, `SubagentStop`, …) are
  `full` in the matrix — connectivity is **not** the reason to keep them command
  hooks (`ConfigChange` stays a command hook for the fail-open-sensitive
  side-effect reason).
- `mcp_tool` expresses a decision **only via the JSON it returns as tool text** —
  it cannot emit exit code 2. On block-capable events it can do a _soft_ block
  (`permissionDecision: "deny"` / `decision: "block"`), but if the server is down
  it **fails open**. For _hard_ enforcement use a command hook + exit 2.
- Because the failure mode is non-blocking, an `mcp_tool` hook standing in for a
  must-fire side-effect (snapshot, state-write) silently no-ops when the server is
  down. Keep those as command hooks even though the event itself is `full`.
- Accepted trade-off: a fail-open-sensitive `PreCompact` side-effect (e.g. a resume
  snapshot) on `mcp_tool` failing open when the server is momentarily down at compact
  time is not an oversight.

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
Start from `.claude/skills/create-plugin/templates/mcp-server.mjs.tmpl`: it uses the
concrete name `example-hooks` — **rename it to your plugin's `<name>-hooks` across
`.mcp.json`, `hooks/hooks.json`, and `server.mjs` (its `SERVER_NAME`).**

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

**`input` is REQUIRED in practice, despite being schema-optional — omitting it means
the tool receives a literal empty `arguments: {}`, NOT the full hook event JSON.** A
hook without `input` still fires successfully (`exitCode: 0`) but its handler sees
`{}` and silently no-ops every guard clause that reads `tool_input`/`cwd`/etc.
(live-verified on Claude Code 2.1.226; see `hooks-mcp-tool-event-matrix.md`'s
`GLOBAL_MECHANICS.input_omitted_default`). Build `input` explicitly with `${...}`
placeholders for every new `mcp_tool` hook; never rely on implicit passthrough.
Substitution is **string-only** (see the event matrix's
`input_substitution_type_preservation`): a placeholder resolving to a
boolean/object in the source hook JSON arrives as a stringified value
(`"true"`/`"false"`), so a handler comparing against a literal `true`/`false` must
also accept the string form for any such field. `plugins/universal-format/CLAUDE.md`'s
"Explicit hook input" section is the worked example.

## `bin/mjs-launch.sh` (OPTIONAL bun-preferred wrapper — not the default)

- Use only when a plugin genuinely needs bun-preferred runtime selection; the
  canonical shape is the direct-`.mjs` `command` shown above. Template:
  `.claude/skills/create-plugin/templates/mjs-launch.sh.tmpl` (prefers bun, falls
  back to node, errors if neither; all messages to stderr because stdout is the MCP
  stdio channel; prepends `~/.local/bin`/`~/.bun/bin` to PATH).
- `.mcp.json` shape with the wrapper: `command: ${CLAUDE_PLUGIN_ROOT}/bin/mjs-launch.sh`,
  `args: ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]`.
- Known caveats: empty PATH segment, lingering signal forwarder.
- A plugin whose wrapper deviates from the template (e.g. appending the user dirs
  instead of prepending them) documents that in its own `CLAUDE.md`.
- Do not "restore" a wrapper for a plugin that intentionally invokes its `.mjs`
  directly.

## Gotchas

- **stdout hygiene:** stdio MCP is JSON-RPC over stdout — every diagnostic to stderr.
- **Executable bit + `node` on PATH:** `mcp/server.mjs` is the file Claude Code
  exec's via `.mcp.json` `command` — it MUST be `chmod +x` (`100755` in git,
  enforced by the hooks-executable rule) and carry a `#!/usr/bin/env node` shebang,
  and `node` must be on the PATH Claude Code launches MCP servers with. A
  non-executable / shebang-less server silently fails to start, and the `mcp_tool`
  hook then fails open. `server.mjs` contains no re-exec shim.
- **Optional bun wrapper:** with `bin/mjs-launch.sh`, the wrapper (not `server.mjs`)
  is what Claude Code exec's and must be `chmod +x`; use `${HOME}`, never `~`, and
  avoid empty PATH segments.
- **Debug logging:** the per-`tools/call` stderr log is gated behind
  `MCP_HOOK_DEBUG` so production hooks stay quiet; set it to confirm the contract.
- **Native Windows:** a `#!/usr/bin/env node` server shebang resolves on native
  Windows via the Node launcher; the optional `bin/mjs-launch.sh` wrapper's
  `#!/usr/bin/env bash` shebang would need a shell/`.exe` shim. WSL2 / Linux / macOS
  are fine either way.
