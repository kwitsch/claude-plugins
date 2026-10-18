# CLAUDE.md — npm-automations/hooks

## Layout (mods hooks module)

- `hooks.json` — exactly `{"modules": ["./register.ts"]}`; no classic command hooks.
- `register.ts` — every hook and every `$` use, typed via `import type { EngineInterface, Register } from 'claude-code'`. No `any`, no `import()`, no Node.
- `policy.mjs` — pure, zero-dep, JSDoc-typed decision logic (`100755`, as every `.mjs` under `hooks/`). It never references `$` and imports no `node:` module (the engine rejects both in a file the module imports); file listings, file contents and env values come in as arguments. Covered by root `tsc`, ESLint and `test/npm-automations/policy.test.mjs`.
- `.claude-plugin/types/` is engine-written at every `claude --plugin-dir` load and gitignored.

## Hook flow (shared, both hooks)

- `tool.call` hooks with matchers `{ tool: "EnterWorktree" }`, `{ tool: "Write" }`, `{ tool: "Edit" }`, each registered only while its toggle is on (toggle off = no hook at all).
- Each awaits `next(e)` first and returns its result unchanged; a denied or errored call does nothing. The tool result is delayed only by the in-process decision (filename check, plus for a `package.json` one `$.fs.read` and one `$.fs.list`).
- The install is fire-and-forget: `enqueue` chains `$.process.run(argv, { cwd, env: { PATH }, timeoutMs: 300000 })` without awaiting it (verified live: it keeps running after the hook returned, as does the `$.session.append` after it).
- Outcome (`outcomeMessage`): clean exit and our own timeout (`aborted: still running after`) stay silent; a binary that cannot start with `ENOENT` gives `<hook>: <bin> not found on PATH, skipped in <cwd>`; any other start error or non-zero exit gives ``<hook>: `<command>` failed in <cwd> (<reason>):\n<truncated stdout+stderr>``. A child killed by a signal reads as exit code 1 (`$.process.run` semantics).
- The line is delivered with `$.session.append` as a user-role meta row of the main conversation, so the model reads it on its next request — the async hook's `additionalContext` equivalent. The model may attribute that row to the user.
- Every `$` failure after `next` is caught: fail open, the tool's result goes back unchanged.

## Package manager detection

- `detectPackageManager(names)` selects the manager from the lockfile among the directory's entry names (order: pnpm, yarn, npm).
  - pnpm-over-npm priority is deliberate: a project mid-migration, with several lockfiles briefly coexisting, prefers the newer lockfile over npm's. `test/npm-automations` pins it.
  - No lockfile: the install hook falls back to npm (`DEFAULT_MANAGER`, first-ever install right after `package.json` is created); the worktree hook stays a silent no-op.
- `pathWithLocalBin(PATH, HOME)` appends `~/.local/bin` and is passed as the child's `PATH` (`$.process.run` resolves `argv[0]` on the `env` PATH it is given, verified live).
  - Why: standalone/corepack pnpm and yarn installs land there, and the session's `PATH` may lack it.
  - Append, never prepend: the inherited `PATH` wins, so a stale `~/.local/bin` binary can never shadow a canonical one.
  - POSIX separators only (a `shortcut:` comment in `policy.mjs`).

## Toggles (shared, both hooks)

- Each hook is gated by its own `userConfig` boolean read from `register`'s `options`; only a literal `false` (boolean, or the string `"false"`) disables (`isEnabled`).
- The fail-open default is deliberate, not an oversight.
  - The hooks create state (`node_modules`, network I/O), so `.claude/rules/plugin-userconfig.md` would normally require fail-closed. Fail-open was chosen explicitly over that default.
  - Worst case of the toggle never resolving is an unwanted background install, not data loss.
  - Do not flip it to fail-closed.
- Before the mods port the toggles came from `CLAUDE_PLUGIN_OPTION_<KEY>` env vars, a route never live-confirmed for command hooks. `options` is the engine's own delivery of the stored values (defaults filled in), so an explicit `false` is now honored.

## Install serialization

- `chains` (module memory) holds one promise chain per directory: an install into a directory starts only after the previous one there settled, so two installs never race on `node_modules` or the lockfile. Both hooks share it.
- It replaces the old tmpdir lock file (`npm-automations-install-<hash>.lock`). `$.fs` has no exclusive create and no delete, so a file lock is not expressible; each chain link is bounded by its own 300 s timeout instead of a shared wait budget, and nothing ever gives up waiting.
- Accepted gaps: it spans one session and one module load. Two sessions installing into the same directory concurrently, or a hot reload while an install runs, are not serialized.

## Hook design (worktree: `npm-ci-on-worktree`)

- Runs the detected manager's lockfile-frozen equivalent of `npm ci` in `EnterWorktree`'s own `worktreePath` (the tool result), so a subagent's worktree is handled too.
- yarn uses classic's `--frozen-lockfile`. Yarn berry deprecated it in favor of `--immutable` but did not remove it, so one flag covers both generations.
- Scope is the entered directory's lockfile only: no monorepo / nested-workspace lockfile walk.

## Hook design (install: `npm-install-on-package-change`)

### Trigger

- Any `Write`/`Edit` whose `file_path` is a `package.json` outside `node_modules` (`isPackageJson`); every other file returns right after `next`, with no `$` call.
- Only `Edit` and `Write` are handled; the current toolset has no `MultiEdit`.

### Pre-edit reconstruction

- Rebuilds the pre-edit file from the Edit tool's own `old_string`/`new_string` (a plain string replace with a function replacer, so `$&`-style sequences stay literal; no git dependency).
- Not `git show HEAD:<path>`: a git-based diff breaks whenever uncommitted changes are stacked before this edit, which is ordinary mid-session state.
- Trusted only when `new_string` is unique in the post-edit content. A `replace_all: true` edit degrades to the bare-install fallback instead of reconstructing a wrong "old" version.
- `Write` carries no prior content, so it always falls back too.

### Scoped install

- `planInstall` installs only the changed/added `dependencies`/`devDependencies`/`optionalDependencies` specs. An edit touching none of them (`version`, `scripts`, `description`, …) triggers no install call; malformed post-edit JSON does nothing.
- `installArgsFor` verb per manager: npm `install <spec>...`; pnpm/yarn `add <spec>...`, since their bare `install` does not accept package specs.
- One flat `<manager> <verb> <spec>...` call is safe; no per-field-grouped invocations.
  - Every spec is read back from the file's current state, already in the correct section.
  - Verified for npm and pnpm: installing a name already declared anywhere in `package.json` updates that entry in place and never moves it into `dependencies`.
- `peerDependencies` is deliberately excluded: the managers do not install these directly the same way.
- Removed dependencies are not uninstalled — out of scope; the hook takes the smallest reasonable action, not a full reconciliation.
