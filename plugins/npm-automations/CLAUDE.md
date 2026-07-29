# CLAUDE.md — npm-automations

Hooks-only plugin (no skills/agents) centralizing npm-lifecycle automation. Both
hooks are independently gated by a fail-open `userConfig` boolean
(`default: true`, only the literal `"false"` disables), read via
`CLAUDE_PLUGIN_OPTION_<KEY>` env vars.

## Hook design (`npm-ci-on-worktree`)

Moved verbatim from `coding-toolbox` (same design, same tests) — centralizing
npm-lifecycle hooks in one plugin rather than bundling them into
`coding-toolbox`'s worktree/PR-focused scope.

`PostToolUse` → `command`, matcher `EnterWorktree`, `timeout: 300`, `async: true`.
Fires after every successful `EnterWorktree` call. Checks only
`<cwd>/package-lock.json` (`cwd` is the hook's live session working directory,
not a fixed project root); if present, runs `npm ci` via `spawnSync`. Silent on
success and on every guard miss (disabled, no `cwd`, no lockfile, killed by its
own timeout); a real `npm ci` failure surfaces truncated stdout+stderr as
`additionalContext`, and `npm` missing from `PATH` gets a one-line note.

**Fail-open toggle is deliberate**, not an oversight: a state-creating action
(`npm ci` writes `node_modules`, does network I/O) would normally default to
fail-closed per `plugin-userconfig.md`, but this was explicitly chosen at the
feature's original design gate (in `coding-toolbox`) — worst case of the env-var
route never resolving is an unwanted background `npm ci`, not data loss.

**Reads `CLAUDE_PLUGIN_OPTION_NPM_CI_ON_WORKTREE`, not a `${user_config.*}`
placeholder in `hooks.json`'s `args`** — the placeholder route hard-errors when
the plugin has never been explicitly configured via `/plugin manage`. The env-var
route is unverified for this specific command-hook subprocess type (only
confirmed absent on a long-lived MCP server process, a different subprocess
kind) but fails open to "enabled" if it's never populated — no worse than the
placeholder's hard-error, and an accepted, documented gap: a user who
explicitly sets `false` and finds it silently unhonored should prompt fixing
this properly (e.g. routing the toggle through a plugin-local MCP server's
`.mcp.json` `env` field instead, a confirmed-working alternative — see
`coding-toolbox`'s `worktree_refresh` hook for that precedent).

No monorepo/nested-workspace lockfile walk (root of the entered worktree only)
and no concurrency guard against two overlapping `EnterWorktree` calls into the
same directory (`npm ci` is safe to re-run — a clean wipe+reinstall from the
lockfile, so the worst case is wasted work, not corruption). The hook trusts
the `PostToolUse` event's `cwd` field as-is, with no cross-check against
`EnterWorktree`'s own reported path — an accepted, unaddressed risk carried
over unchanged from the original design.

## Tests

`test/npm-automations/` — `test_helper.bash` holds `common_setup` (isolated
`$HOME`, `$REPO_ROOT`/`$PLUGIN`/`$HOOKS`) and `rg_or_grep`; each `.bats` file
loads it via `load 'test_helper'` and declares its own `setup() { common_setup; }`.
`manifest.bats` covers plugin.json/marketplace/root-README/test.yml-matrix
invariants and generic README structure; `npm-ci-on-worktree.bats` +
`.test.mjs` cover that hook's behavior end to end (bats, process-level) and its
pure functions (`node:test`, unit-level).
Run: `BATS_LIB_PATH="$PWD/node_modules" npx bats test/npm-automations/`
