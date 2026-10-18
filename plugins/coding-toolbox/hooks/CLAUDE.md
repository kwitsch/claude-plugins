# CLAUDE.md — coding-toolbox/hooks

Do not "fix" any hook below without reading its section.

## Layout (mods hooks module)

- `hooks.json` is exactly `{"modules": ["./register.ts"]}`: one in-process mods function-hooks module, no command hook, no MCP server, no process per event. Module rules (no `any`, no `import()`, no Node, `.claude-plugin/types/` engine-written and gitignored) as in `plugins/inline-headroom/CLAUDE.md`.
- `register.ts` holds every hook and every `$` use, typed via `import type { EngineInterface, Register } from 'claude-code'`.
- `policy.mjs` is pure, zero-dep, JSDoc-typed logic that never references `$`. Effects reach it as small `io` objects whose closures `register.ts` builds over `$` (`GuardIo`: `stat`/`sample`; `RefreshIo`: `git`/`realPath`). That keeps the whole detection and refresh flow in `policy.mjs`, so `node --test` drives it with `node:fs`/`child_process` (`test/coding-toolbox/*.test.mjs`).
- `../tests/coding-toolbox.test.ts` covers the wiring under `claude plugin test` (local only; CI has no `claude` CLI).
- Measured costs this replaced: the command hook spawned node on every `Read|Edit|Write|Bash` call (34–43 ms); the hook-only MCP server cost ~100 ms startup plus a resident node process per session. A mods `tool.call` hook is a ~5–10 ms worker hop.

## Encoding guard (`tool.call`, `{ tool: ["Read", "Edit", "Write", "Bash"] }`)

Blocks content operations on non-UTF-8 files by answering `{ deny: reason }` without calling `next` (the model reads the reason as the tool's error; the tool never runs).

- Contract: false negatives OK, false positives never — the Bash analysis is precision-biased (`bashCandidates`). Binary, empty and missing files pass. Self-contained: no `cc-tools` dependency, and `cc-tools` invocations pass.
- The reason text is byte-identical to the former command hook's `permissionDecisionReason`: encoding plus an `iconv` hint.
- Paths resolve against `$.session.cwd()` (read inside the hook: a subagent's own) and `$.env.get("HOME")` for `~`.
- A leading `rtk` word is a transparent wrapper (`rtk read X` = `cat X`, `rtk grep`/`rg`/`diff` keep their names): linux-token-efficiency's `tool.call` rtk rewrite may run before this hook in the mods chain (cross-plugin order is undocumented), so the guard must see through it.
- Sampling: the first 64 KiB decide. A file up to `FULL_READ_MAX` (1 MiB) is read whole with `$.fs.read(path, { as: "bytes" })` (no range read exists) and sliced; a larger one is sampled through `$.process.run(["sh", "-c", 'head -c 65536 "$1" | base64', ...])`, so a huge file never crosses the worker boundary in full. That spawn is paid only for files over 1 MiB, keeping parity with the old hook, which sampled every size.
- Fail open, deliberately no `.catch`: a hook that throws, answers a wrong shape or outlasts its budget is skipped by the engine and the tool runs. Per-file errors (stat, read, spawn) classify as safe inside `classifyFile`.
- Why a mods hook is acceptable for a hard deny gate: the old note ("must stay a command hook — `mcp_tool` fails open on a down server") was about a separate server process that may not be connected. A mods hook runs in-process, loaded with the plugin, with no connection to lose. Its remaining fail-open paths (a throw, the hook budget) are the same as the command hook's own (it exited 0 silently on every internal error), so the gate is no weaker than before.

## Worktree refresh (`tool.call`, `{ tool: "EnterWorktree" }`, after the tool ran)

### Behavior

- Registered only while `options.worktree_refresh` is enabled (fail-open: only a literal `false`/`"false"` disables). An options change reloads the module, so a toggle change takes effect immediately, unlike the old MCP server env (read once at server start).
- `await next(e)` first; a deny, an errored result, or a `path` argument (switch into an existing worktree) returns the result untouched.
- Target directory: the result's `worktreePath`, falling back to `$.session.cwd()`.
- Fetches and rebases the new worktree onto the repo's default branch on `origin`, mirroring `fresh-branch`'s `refresh_onto()` logic (`refreshWorktree` in `policy.mjs`). Linked-worktree detection compares the realpaths (`$.fs.stat(path, { resolve: true })`) of `--git-dir` and `--git-common-dir`, each resolved against the target cwd.
- Fails open silently on every non-actionable case (switch, non-worktree cwd, no remote).
- Reports a fetch failure or rebase conflict by appending one note to the result's `context` (what a PostToolUse `additionalContext` was), never a deny. A conflict is always `git rebase --abort`ed first, so the worktree is never left mid-rebase.
- Synchronous by design: the tool's result reaches the model only after the refresh settled, since it mutates the worktree's branch tip.

### Why EnterWorktree, not WorktreeCreate

- Do not move this to a `WorktreeCreate` hook: that event _replaces_ Claude Code's entire git-worktree-creation logic globally (CLI `--worktree`, subagent `isolation: worktree`, background sessions — in every project with the plugin enabled), so a bug there breaks worktree creation everywhere.
- Accepted scope gap: worktrees created by the CLI, subagents or background sessions are not refreshed.

### Git timeout

- Every `git` call is `$.process.run(["git", ...], { cwd, timeoutMs: 30_000 })`. The bound is per call, not per fire: a worst-case fire (`remote set-head`, `remote show origin`, `fetch`, `rebase`) can add up to a multiple of it.
- A timeout rejects; it surfaces through the same fetch-failure / rebase-report path as any other git failure, never as a hang.

## Interaction gate (`turn.start` + `turn.complete`)

A main-loop turn whose answer ends with a plain-text question gets one plugin prompt telling Claude to redo it via `AskUserQuestion`.

- Heuristic (`isBareQuestion`): strip fenced code blocks, take the last non-empty line; if it ends in `?`, gate. Keep it blunt: a rhetorical trailing `?` is an accepted false positive, traded for simplicity and for matching the Interaction axis's own "no exceptions" wording.
- Only `reason === "answer"` main-loop turns (`e.agentId === undefined`); subagents, interrupted and errored turns are never gated.
- Mechanism: user-tier mods have no native Stop block (`classic.Stop` is bypassed by `cc-plugin-sec-default`). `turn.complete` therefore calls `$.prompt.submit({ text: GATE_REASON })` unawaited: the engine queues a framed plugin prompt ("The coding-toolbox plugin sent a message: …") that starts a new turn once the session is idle. Awaiting it would wait for that turn to start, which waits for this turn to end.
- Loop guard (replaces the platform's `stop_hook_active` and 8-consecutive-block cap): `turn.start` records the main-loop turn whose prompt contains `GATE_REASON` (`isGateTurn`), and `turn.complete` never gates that turn. So at most one re-prompt per user turn. Backstop for a framing change the text match would miss: a submit also marks the next main-loop turn as the gate's (`gatePending`), so the gate can never loop; a user prompt that happens to start first takes that exemption instead (at worst one missed gate). Module state: a hot reload forgets both, which at worst lets one more re-prompt through.
- Behaviour change vs. the old `Stop` block: the questioning answer is no longer suppressed — the turn ends, its answer stays visible, and the correction arrives as a separate turn. In `claude -p` that second turn runs before the process exits.
