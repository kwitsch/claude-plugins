# CLAUDE.md — npm-automations/hooks

## Package manager detection (shared design, both hooks)

- `detectPackageManager` selects the manager from the lockfile present (order in the source: pnpm, yarn, npm).
  - pnpm-over-npm priority is deliberate: a project mid-migration, with several lockfiles briefly coexisting, prefers the newer lockfile over npm's. `test/npm-automations` pins it.
  - No lockfile: `npm-install-on-package-change` falls back to npm (first-ever install right after `package.json` is created); `npm-ci-on-worktree` stays a silent no-op.
- `detectPackageManager`, `pathWithLocalBin`, `truncate` and `ctx` are duplicated verbatim in each hook file — each command hook is a fully self-contained process, so do not extract a shared module.
- `pathWithLocalBin` appends `~/.local/bin` to the spawned process's `PATH`.
  - Why: standalone/corepack pnpm and yarn installs land there, and a non-login command-hook `PATH` may lack it. Same gap the bun-preferred `mjs-launch.sh` works around (`.claude/rules/hooks-mcp-server.md`, template `.claude/skills/create-plugin/templates/mjs-launch.sh.tmpl`).
  - Append, never prepend: the inherited `PATH` wins, so a stale `~/.local/bin` binary can never shadow a canonical one. Same rule as the `mjs-launch.sh` wrappers of `coding-toolbox` and `universal-format`.
- Fail open, exit 0 on every branch: only a real install failure (truncated stdout+stderr), the manager's binary missing from `PATH`, or (install hook) giving up on a contended lock emits `additionalContext`. Guard misses and the hook's own timeout kill stay silent.

## Toggles (shared, both hooks)

- Each hook is gated by its own `userConfig` boolean, read from a `CLAUDE_PLUGIN_OPTION_<KEY>` env var; only the literal `"false"` disables.
- The fail-open default is deliberate, not an oversight.
  - The hooks create state (`node_modules`, network I/O), so `.claude/rules/plugin-userconfig.md` would normally require fail-closed. Fail-open was chosen explicitly over that default.
  - Worst case of the toggle never resolving is an unwanted background install, not data loss.
  - Do not flip it to fail-closed.
- The toggle comes from the env var, not a `${user_config.*}` placeholder in `hooks.json`'s `args`: the placeholder hard-errors when the plugin was never explicitly configured via `/plugin manage`.
- The env-var route is not live-confirmed for this command-hook subprocess type. Only an MCP server process was observed without it (a different subprocess kind); cc-reference documents hook processes as receiving it.
  - If it is never populated, the hook resolves to "enabled" — no worse than the placeholder's hard error.
  - Accepted gap: a user who explicitly sets `false` and finds it silently unhonored should prompt fixing this properly.
  - The fix to reach for: route the toggle through a plugin-local MCP server's `.mcp.json` `env` field, a confirmed-working alternative (precedent: `coding-toolbox`'s `worktree_refresh` hook).

## Hook design (`npm-ci-on-worktree`)

- Runs the detected manager's lockfile-frozen equivalent of `npm ci` in the hook input's `cwd` — the live session working directory after `EnterWorktree`, not a fixed project root.
- yarn uses classic's `--frozen-lockfile`. Yarn berry deprecated it in favor of `--immutable` but did not remove it, so one flag covers both generations.
- Scope is the entered directory's lockfile only: no monorepo / nested-workspace lockfile walk.
- No concurrency guard against overlapping `EnterWorktree` calls into the same directory. Re-running a frozen install is safe, so the worst case is wasted work, not corruption.
- Trusts the `PostToolUse` event's `cwd` as-is, with no cross-check against `EnterWorktree`'s own reported path — an accepted, unaddressed risk.

## Hook design (`npm-install-on-package-change`)

### Trigger

- Dispatches on any file named `package.json`, filtered in code via `tool_input.file_path` (the idiom `universal-lint`'s `lint-file.mjs` uses) rather than the `hooks.json` `if` field.
- Only `Edit` and `Write` are handled; the current toolset has no `MultiEdit`.

### Pre-edit reconstruction

- Rebuilds the pre-edit file from the Edit tool's own `old_string`/`new_string` (a plain string replace, no git dependency).
- Not `git show HEAD:<path>`: a git-based diff breaks whenever uncommitted changes are stacked before this edit, which is ordinary mid-session state.
- Trusted only when `new_string` is unique in the post-edit content. A `replace_all: true` edit (`new_string` then appears more than once) degrades to the bare-install fallback instead of reconstructing a wrong "old" version.
- `Write` carries no prior content in `tool_input`, so it always falls back too.

### Scoped install

- Installs only the changed/added `dependencies`/`devDependencies`/`optionalDependencies` specs. An edit touching none of them (`version`, `scripts`, `description`, …) triggers no install call, satisfying "don't unnecessarily bump dependencies".
- `installArgsFor` verb per manager: npm `install <spec>...`; pnpm/yarn `add <spec>...`, since their bare `install` does not accept package specs.
- One flat `<manager> <verb> <spec>...` call is safe; no per-field-grouped invocations.
  - Every spec is read back from the file's current state, already in the correct section.
  - Verified for npm and pnpm: installing a name already declared anywhere in `package.json` updates that entry in place and never moves it into `dependencies`.
- `peerDependencies` is deliberately excluded: the managers do not install these directly the same way.
- Removed dependencies are not uninstalled — out of scope; the hook takes the smallest reasonable action, not a full reconciliation.

### Filesystem lock

- Why a lock: unlike the sibling hook (at most once per `EnterWorktree`), `Write|Edit` can fire on the same `package.json` repeatedly in quick succession. Each firing is a fresh async OS process with no shared state, and overlapping installs in one directory race on `node_modules`/the lockfile.
- The lock file lives in the OS temp dir, keyed by a hash of the target directory — deliberately outside the project tree, so it is never visible to `git status`/`git add -A` and never lingers in a tracked directory after a crash.
- Waiting is bounded and synchronous: the process is already async from the harness's perspective, so blocking costs nothing.
- Lock wait and install share one deadline budget, not one each: two full budgets could together overrun `hooks.json`'s own 300 s timeout and get the process killed mid-install.
- A lock older than `LOCK_STALE_MS` is treated as abandoned (crashed prior process) and reclaimed.
- The lock is always released in a `finally` block, including on install failure/timeout.
- Accepted trade-off (correctness over latency): a hard `SIGKILL` is the one case that leaves a stale lock, bounded by `LOCK_STALE_MS` before a later edit reclaims it.
