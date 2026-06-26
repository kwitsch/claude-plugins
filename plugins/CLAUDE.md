# CLAUDE.md — plugins/

Conventions for all plugins here.

## Structure
Each plugin: `.claude-plugin/plugin.json` (manifest: `version` plus metadata like `name`/`description`/`userConfig`, and may declare `dependencies`) + components + `README.md` + `CLAUDE.md`. Matching bats suite in `test/<name>/` (see `.claude/rules/test-conventions.md`). The `version` field lives only here — never in `marketplace.json` entries (see `.claude/rules/plugin-versioning.md`).

**Important**: Only `plugin.json` goes inside `.claude-plugin/`. All component dirs at plugin root.

| Directory/File | Purpose |
|---|---|
| `skills/` | Skills as `<name>/SKILL.md` dirs — **preferred for new plugins** |
| `commands/` | Skills as flat `.md` files — legacy, avoid for new plugins |
| `agents/` | Custom agent definitions |
| `hooks/` | Event handlers in `hooks.json` |
| `mcp/` | Self-contained zero-dep MCP stdio server (`server.mjs`) backing `mcp_tool` hooks, invoked directly as the `.mcp.json` `command` (executable `.mjs`, `#!/usr/bin/env node`, `100755`) |
| `bin/` | Executables added to Bash `PATH` when plugin enabled (must be chmod +x) |
| `.mcp.json` | MCP server configs |
| `.lsp.json` | LSP server configs for code intelligence |
| `monitors/monitors.json` | Background monitors (watch logs/files, notify Claude per stdout line) |
| `settings.json` | Default settings when plugin enabled; only `agent` + `subagentStatusLine` keys honored |

## Hooks
Pick by the decision tree (see `.claude/rules/hooks-mcp-server.md`) — a command hook
is required only in the cases below; otherwise prefer `mcp_tool`. Confirm the event's
row in `.claude/rules/hooks-mcp-tool-event-matrix.md` (`documented` rows only).
- **command hook** when **any** holds: the event fires **before the server connects**
  (`SessionStart`/`Setup`); it must be a **fail-closed hard gate** (needs exit 2 —
  `mcp_tool` fails open); it is a **fail-open-sensitive side-effect that must reliably
  fire** (e.g. a `PreCompact` snapshot, or a state-write other hooks read); or it is
  **latency-sensitive / high-frequency** (`UserPromptSubmit` 30 s, `MessageDisplay`
  10 s). New/rewritten command hooks: Node ES modules (`.mjs`), not shell scripts.
- **`mcp_tool` hook** otherwise — non-blocking, mid-session context injection /
  observation (`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, … — all `full` in
  the matrix). **Preferred:** backed by a self-contained plugin-local MCP server
  (`mcp/server.mjs`), invoked **directly** as the `.mcp.json` `command`
  (`command: ${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs` — an executable `.mjs` with
  `#!/usr/bin/env node` + git mode `100755`, node-only, no `args`). A plugin needing
  bun-preferred runtime selection MAY instead use an optional `bin/mjs-launch.sh`
  wrapper (`command: ${CLAUDE_PLUGIN_ROOT}/bin/mjs-launch.sh`, `args:
  ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]`), but it is no longer the default.
  `mcp_tool` can *soft*-block via returned JSON but never hard-gate.

Existing `.sh` hooks stay until rewritten.
