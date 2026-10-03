# CLAUDE.md — npm-automations

Hooks-only plugin (no skills/agents) centralizing npm-lifecycle automation. Both
hooks are independently gated by a fail-open `userConfig` boolean
(`default: true`, only the literal `"false"` disables), read via
`CLAUDE_PLUGIN_OPTION_<KEY>` env vars.

## Hooks

See `plugins/npm-automations/hooks/CLAUDE.md` for the shared package-manager-detection and toggle design and both hooks' (`npm-ci-on-worktree`, `npm-install-on-package-change`) individual design detail.

## Tests

See `test/npm-automations/CLAUDE.md` for the suite layout and run commands.
