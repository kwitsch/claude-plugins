# CLAUDE.md — plugins/

Conventions for all plugins here.

## Structure
Each plugin: `.claude-plugin/plugin.json` (manifest, holds only `version`) + components + `README.md` + `CLAUDE.md`. Matching bats suite in `test/<name>/` (see `test/CLAUDE.md`).

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

## Versioning
Every plugin change requires a `plugin.json` version bump — no exceptions.

| Change type | Example |
|---|---|
| Feature (new behavior, new component) | `1.0.0` → `1.1.0` |
| Bug fix | `1.0.0` → `1.0.1` |

Use semver: `MAJOR.MINOR.PATCH`. Breaking changes bump MAJOR.

## Feature toggles (userConfig)
Every plugin feature togglable via dedicated boolean `userConfig` in plugin.json (`default: true`, title + description). Claude Code stores values in settings.json under `pluginConfigs["<plugin>"].options` (scope: local > project > user), interpolates into skills as `${user_config.KEY}`.

Fail-open: ONLY literal `false` disables; `true`, empty, or uninterpolated `${user_config.…}` placeholder all count enabled. Exception: toggles whose enabled state creates files/state are fail-closed (only literal `true` enables; e.g. branch-management `graphify_force_create`) — placeholder must never create anything.

Three hook-only plugins (cctools-edit, git-sign-key, no-co-authored) predate rule, declare no `userConfig` yet.

## Hooks
New/rewritten hooks: Node ES modules (`.mjs`), not shell scripts. Existing `.sh` hooks stay until rewritten.