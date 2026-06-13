# CLAUDE.md — plugins/

Conventions for all plugins here.

## Structure
Each plugin: `.claude-plugin/plugin.json` (manifest, holds only `version`) + components + `README.md` + `CLAUDE.md`. Matching bats suite in `test/<name>/` (see `.claude/rules/test-conventions.md`).

**Important**: Only `plugin.json` goes inside `.claude-plugin/`. All component dirs at plugin root.

| Directory/File | Purpose |
|---|---|
| `skills/` | Skills as `<name>/SKILL.md` dirs — **preferred for new plugins** |
| `commands/` | Skills as flat `.md` files — legacy, avoid for new plugins |
| `agents/` | Custom agent definitions |
| `hooks/` | Event handlers in `hooks.json` |
| `mcp/` | Self-contained zero-dep MCP stdio server (`server.mjs`, chmod +x) backing `mcp_tool` hooks |
| `bin/` | Executables added to Bash `PATH` when plugin enabled (must be chmod +x) |
| `.mcp.json` | MCP server configs |
| `.lsp.json` | LSP server configs for code intelligence |
| `monitors/monitors.json` | Background monitors (watch logs/files, notify Claude per stdout line) |
| `settings.json` | Default settings when plugin enabled; only `agent` + `subagentStatusLine` keys honored |

## Hooks
Pick by the decision tree (see `.claude/rules/hooks-mcp-server.md`):
- **Non-blocking, mid-loop** (`PreToolUse`/`PostToolUse`) → **preferred:** an
  `mcp_tool` hook backed by a self-contained plugin-local MCP server
  (`mcp/server.mjs`, bun-preferred with node fallback, registered directly in
  `.mcp.json`).
- **Early-lifecycle** (`SessionStart`, etc.) or **fail-closed guards** → command
  hooks. New/rewritten command hooks: Node ES modules (`.mjs`), not shell scripts.

Existing `.sh` hooks stay until rewritten.
