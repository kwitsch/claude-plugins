---
paths:
  - "plugins/*/.claude-plugin/plugin.json"
---

# Rule: plugin.json userConfig feature toggles

Every plugin feature must be togglable via a dedicated boolean `userConfig` entry in `plugin.json` with `default: true`, a `title`, and a `description`.

## Storage and interpolation

Claude Code stores values under `pluginConfigs["<plugin>"].options` in settings.json (scope: local > project > user) and interpolates into skills as `${user_config.KEY}`.

## Fail-open default

ONLY literal `false` disables a feature. All of the following count as enabled:
- literal `true`
- empty / missing value
- uninterpolated `${user_config.…}` placeholder

## Exception: fail-closed for state-creating toggles

Toggles whose enabled state creates files or external state must be fail-closed: only literal `true` enables. Example: `graphify_force_create` in branch-management. An uninterpolated placeholder must NEVER create files or external state.

## Legacy exception

Three hook-only plugins predate this rule and declare no `userConfig` yet: `cctools-edit`, `git-sign-key`, `no-co-authored`.
