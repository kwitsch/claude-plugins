# CLAUDE.md — npm-automations

Hooks-only plugin (no skills/agents) centralizing npm-lifecycle automation. Both
hooks are independently gated by a fail-open `userConfig` boolean
(`default: true`, only the literal `"false"` disables), read via
`CLAUDE_PLUGIN_OPTION_<KEY>` env vars.

## Hooks

See `plugins/npm-automations/hooks/CLAUDE.md` for the shared package-manager-detection design and both hooks' (`npm-ci-on-worktree`, `npm-install-on-package-change`) individual design detail.

## Tests

`test/npm-automations/` — `test_helper.bash` holds `common_setup` (isolated
`$HOME`, `$REPO_ROOT`/`$PLUGIN`/`$HOOKS`) and `rg_or_grep`; each `.bats` file
loads it via `load 'test_helper'` and declares its own `setup() { common_setup; }`.
`manifest.bats` covers plugin.json/marketplace/root-README/test.yml-matrix
invariants and generic README structure; `npm-ci-on-worktree.bats` +
`.test.mjs` cover that hook's behavior end to end (bats, process-level) and its
pure functions (`node:test`, unit-level).
Run: `BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/npm-automations/`
