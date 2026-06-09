# CLAUDE.md — plugins/

Conventions for all plugins here.

## Structure
Each plugin: `.claude-plugin/plugin.json` (manifest, holds only `version`) + components (`commands/`, `hooks/`, `skills/`, `agents/`, `bin/`) + `README.md` + `CLAUDE.md`. Matching bats suite in `test/<name>/` (see `test/CLAUDE.md`).

## Feature toggles (userConfig)
Every plugin feature togglable via dedicated boolean `userConfig` option in plugin.json (`default: true`, title + description). Claude Code stores values in settings.json under `pluginConfigs["<plugin>"].options` (scope precedence: local > project > user), interpolates into skills as `${user_config.KEY}`.

Eval fail-open: ONLY literal `false` disables; `true`, empty, or uninterpolated `${user_config.…}` placeholder all count enabled. Exception: toggles whose enabled state creates new files/state are fail-closed (only literal `true` enables; e.g. branch-management `graphify_force_create`) — placeholder must never create anything.

Three hook-only plugins (cctools-edit, git-sign-key, no-co-authored) predate rule, declare no `userConfig` yet.

## Hooks
New or rewritten hooks: Node ES modules (`.mjs`), not shell scripts. Existing `.sh` hooks stay until rewritten.