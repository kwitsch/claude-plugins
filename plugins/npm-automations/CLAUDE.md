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

## Hook design (`npm-install-on-package-change`)

`PostToolUse` → `command`, matcher `Write|Edit`, `timeout: 300`, `async: true`.
Dispatches on any file named `package.json` (checked via `tool_input.file_path`,
the same in-code path-filtering idiom `universal-lint`'s `lint-file.mjs` uses,
rather than the `hooks.json` `if` field).

**Reconstructs the pre-edit file from the Edit tool's own `old_string`/
`new_string`** (a plain string replace, no git dependency) rather than diffing
against `git show HEAD:<path>` — a git-based diff breaks whenever the file has
pending uncommitted changes stacked before this edit, which is ordinary mid-session
state. Only trusted when `new_string` is unique in the post-edit content (single,
unambiguous replace target) — this also safely degrades a `replace_all: true` edit
(whose `new_string` then appears more than once) to the bare-install fallback
instead of reconstructing a wrong "old" version. `Write` has no prior content in
`tool_input` at all, so it always falls back too. There is no `MultiEdit` tool in
the current toolset (verified empty on grep across this repo and this session's own
tool/deferred-tool lists) — only `Edit` and `Write` are handled.

**Runs `npm install` scoped to only the changed/added
`dependencies`/`devDependencies`/`optionalDependencies` specs** — a version-only (or
`scripts`/`description`/etc.) edit triggers no npm call at all, directly satisfying
the "don't unnecessarily bump dependencies" ask. Verified experimentally (npm
11.16.0, scratch repo): `npm install <name>@<range>` for a name already declared
anywhere in `package.json` updates that entry **in place** — it does not move it
into `dependencies`. Since every spec here is read back from the file's own
_current_ state (already written to the correct section by the edit itself before
this hook ever runs), a single flat `npm install <spec>...` call is safe; no
per-field-grouped invocations are needed. `peerDependencies` is deliberately
excluded (npm doesn't install these directly the same way); removed dependencies
are not uninstalled (out of scope, matches "kleinstmöglichstes npm i" — smallest
reasonable action, not a full reconciliation).

**Filesystem lock serializes concurrent installs in the same directory.** Unlike
the sibling `npm-ci-on-worktree` hook (fires at most once per `EnterWorktree`),
`Write|Edit` can fire on the same `package.json` repeatedly in quick succession,
and each firing is a fresh async OS process with no shared in-memory state — two
overlapping `npm install` runs in one directory can race on `node_modules`/the
lockfile. `acquireLock` takes an exclusive lock (atomic `open(..., "wx")` on a lock
file in the OS temp dir, keyed by a hash of the target directory via `lockPathFor`
— deliberately outside the project tree, so it's never visible to `git status`/
`git add -A` and never lingers in a tracked directory after a crash) before
spawning npm; if already held, it busy-waits (bounded, synchronous — this process
is already async from the harness's
perspective, so blocking it costs nothing), then proceeds once free. The lock wait
and the `npm install` call share **one** budget, not one each: the handler computes
a single deadline (`Date.now() + timeoutMs`) up front, hands `acquireLock` whatever
remains, then hands npm whatever remains after that (floored at 1 ms — `spawnSync`
reads `timeout: 0` as _no_ timeout) — two full budgets could together overrun
`hooks.json`'s own 300 s timeout and get this process killed mid-install. A lock older than
`LOCK_STALE_MS` (10 minutes) is treated as abandoned (e.g. a crashed prior process)
and reclaimed. The lock is always released in a `finally` block, including on npm
failure/timeout — a hard `SIGKILL` of this process is the one case that can leave a
stale lock behind, bounded by `LOCK_STALE_MS` before a later edit reclaims it;
accepted trade-off for correctness over latency.

**Same fail-open toggle convention as the sibling hook** — `CLAUDE_PLUGIN_OPTION_
NPM_INSTALL_ON_PACKAGE_CHANGE`, only the literal `"false"` disables.

## Tests

`test/npm-automations/` — `test_helper.bash` holds `common_setup` (isolated
`$HOME`, `$REPO_ROOT`/`$PLUGIN`/`$HOOKS`) and `rg_or_grep`; each `.bats` file
loads it via `load 'test_helper'` and declares its own `setup() { common_setup; }`.
`manifest.bats` covers plugin.json/marketplace/root-README/test.yml-matrix
invariants and generic README structure; `npm-ci-on-worktree.bats` +
`.test.mjs` cover that hook's behavior end to end (bats, process-level) and its
pure functions (`node:test`, unit-level).
Run: `BATS_LIB_PATH="$PWD/node_modules" npx bats test/npm-automations/`
