# CLAUDE.md — coding-toolbox/mcp

`mcp/server.mjs` backs the plugin's two `mcp_tool` hooks: `interaction_gate` (Stop) and `worktree_refresh` (PostToolUse/EnterWorktree). The server is zero-dep and stateless. Design of the Stop gate and the `encoding-guard.mjs` command hook: `plugins/coding-toolbox/hooks/CLAUDE.md`.

## Launcher (do not "fix" without reading this)

- `.mcp.json` invokes `bin/mjs-launch.sh` with `mcp/server.mjs` as its `args` — never `server.mjs` directly.
- The wrapper exists so the zero-dep server runs under `bun` when available, for runtime parity with `universal-lint`/`universal-format`/`claude-code-knowledge`. `server.mjs` carries no inline re-exec shim — the wrapper is the sole runtime selector.
- The server spawns no external tool but `git`, so the siblings' rationale for the wrapper (fixing `PATH` for external tool lookups) does not apply here.
- The wrapper stays a byte-for-byte copy of `universal-lint`'s hardened form: `PATH` is **appended**, not prepended — same rationale as that plugin's CLAUDE.md.

## `worktree_refresh` (PostToolUse, matcher `EnterWorktree`: `tool: "worktree_refresh"`)

### Behavior

- Fires only after `EnterWorktree` creates a _new_ worktree (`tool_input` has no `path` key — a `path` call switches into an existing worktree).
- Fetches and rebases the new worktree onto the repo's default branch on `origin`, mirroring `fresh-branch`'s `refresh_onto()` logic.
- Uses `tool_response.worktreePath` as the target directory, falling back to `cwd`; both already point at the new worktree when `PostToolUse` fires.
- Fails open silently on every non-actionable case (switch, non-worktree cwd, no remote).
- Reports a fetch failure or rebase conflict via `hookSpecificOutput.additionalContext`, never `decision: block`. A conflict is always `git rebase --abort`ed first, so the worktree is never left mid-rebase.
- Stays synchronous, not `async: true`: it mutates the worktree's branch tip, and Claude must not act on the worktree before that settles.

### Why PostToolUse/EnterWorktree, not WorktreeCreate

- Do not move this to a `WorktreeCreate` hook: that event _replaces_ Claude Code's entire git-worktree-creation logic globally (CLI `--worktree`, subagent `isolation: worktree`, background sessions — in every project with the plugin enabled), so a bug there breaks worktree creation everywhere.
- Accepted scope gap: worktrees created by the CLI, subagents or background sessions are not refreshed; `WorktreeCreate` would be the only way to close it.

### Git timeout

- Every `git` call carries a per-call `timeout: 30_000`.
- The server handles stdin messages synchronously on one thread, so an unbounded `git` against a slow or unreachable remote would block every later tool call on this server, not just this hook.
- The bound is **per call, not per fire**: a worst-case fire (`remote set-head`, `remote show origin`, `fetch`, `rebase`) can add up to a multiple of it.
- A call killed by the timeout surfaces through the same fetch-failure / rebase-report path as any other git failure, never as a hang.
- `interaction_gate` calls no git, so the Stop gate is unaffected.

### Toggle (`userConfig.worktree_refresh`, `default: true`)

- Fail-open convention: only the literal `"false"` disables.
- Read once at server start from the `CODING_TOOLBOX_WORKTREE_REFRESH` env var, not argv — the hook runs inside the long-lived server process, not a fresh per-event command spawn.
- `.mcp.json`'s `env` field interpolates `${user_config.worktree_refresh}` into that var. `${user_config.*}` substitution works in MCP server configs, but NOT inside an `mcp_tool` hook's own `input` field in `hooks.json` (that field only substitutes hook-event data like `${tool_input.file_path}`) — which is why the value is threaded through `.mcp.json`.
- A toggle change takes effect only on the next server restart (session restart / plugin reconnect) — the lag any `mcp_tool`-hook userConfig value has, not a bug.
