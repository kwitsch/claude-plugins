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
| `bin/` | Executables added to Bash `PATH` when plugin enabled (must be chmod +x) |
| `.mcp.json` | MCP server configs |
| `.lsp.json` | LSP server configs for code intelligence |
| `monitors/monitors.json` | Background monitors (watch logs/files, notify Claude per stdout line) |
| `settings.json` | Default settings when plugin enabled; only `agent` + `subagentStatusLine` keys honored |

## Hooks
New/rewritten hooks: Node ES modules (`.mjs`), not shell scripts. Existing `.sh` hooks stay until rewritten.
