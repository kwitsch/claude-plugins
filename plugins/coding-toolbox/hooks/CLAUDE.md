# CLAUDE.md — coding-toolbox/hooks + mcp

## Hook design (do not "fix" without reading this)

**Stop → `mcp_tool` hook (no matcher — `Stop` ignores it): `tool: "interaction_gate"`**
(2026-07-01 addition, closing a gap where a turn ended with a plain-text question
instead of going through `AskUserQuestion`). Uses the documented `last_assistant_message` Stop-hook
input field — Claude's final response text, given directly, no transcript parsing
needed. Heuristic: strip fenced code blocks, take the last non-empty line; if it ends
in `?`, return `{"decision":"block","reason":"…"}` (from `HookResult`, already typed)
telling Claude to redo it via `AskUserQuestion`; otherwise `{}` (allow the stop). This
is deliberately a blunt heuristic — it will occasionally flag a rhetorical trailing
"?" as a false positive — traded for simplicity and for matching axis 1's own "no
exceptions" wording. No extra loop-guard needed: the platform's `stop_hook_active`
input and 8-consecutive-block cap already bound the worst case. Stateless — do not
add a counter here.

**`.mcp.json` invokes `bin/mjs-launch.sh` (not `mcp/server.mjs` directly), with
`mcp/server.mjs` as its `args`** (2026-07-16 fix — the un-migrated original
scaffold had invoked `mcp/server.mjs` directly, node-only, the only one of this
repo's four self-contained MCP servers never given the bun-preferred wrapper
`universal-lint`/`universal-format`/`claude-code-knowledge` already carry).
Unlike those three siblings, `interaction_gate` spawns no external tool at
all, so their stated rationale ("the natural place to fix PATH for the
non-interactive MCP-spawn's external tool lookups") does not transfer here —
this wrapper exists purely so the zero-dep server itself can run under `bun`
when available, for runtime parity with the rest of the repo. The wrapper is
still a byte-for-byte copy of `universal-lint`'s hardened form (PATH
**appended**, not prepended — same rationale as that plugin's own CLAUDE.md)
since its bun-discovery role is identical even though its tool-discovery role
is not. `server.mjs` itself is unchanged — no inline re-exec shim, the
wrapper is the sole runtime selector.

The `PreToolUse` entry (`hooks/encoding-guard.mjs`, matcher
`Read|Edit|Write|Bash`) is a hard deny gate and therefore a **command hook**,
not an `mcp_tool` — the event matrix forbids `mcp_tool` for hard gates (a
down server silently fails open). Zero-dep executable Node script invoked
directly (shebang + git mode `100755`). Detection is pure Node over a 64 KiB
head sample: BOM sniff → strict UTF-8 validation (ASCII never mislabeled) →
NUL-parity UTF-16 heuristic → legacy single-byte fallback; binary, empty and
missing files are safe. Bash commands get a precision-biased literal-token
analysis (heredoc-body strip, quote/substitution blanking, per-segment
content-tool deny-set plus output-redirect targets) with a
false-negatives-OK/false-positives-never contract, self-contained (no
cc-tools dependency; `cc-tools` invocations pass). Deny
is PreToolUse JSON (`permissionDecision: "deny"`) naming the encoding + an
iconv hint; every internal error exits 0 silently (fail open).

## Hook design (`worktree_refresh`)

**`PostToolUse` → `mcp_tool` hook, matcher `EnterWorktree`: `tool: "worktree_refresh"`**
(2026-07-24 addition). After `EnterWorktree` creates a _new_ worktree (`tool_input`
has no `path` key — a `path` call is a switch into an existing worktree, not a
creation), fetches and rebases it onto the repo's default branch on `origin`,
mirroring `fresh-branch`'s own `refresh_onto()` logic. Deliberately **not** a
`WorktreeCreate` hook: per the official docs, `WorktreeCreate` _replaces_ Claude
Code's entire git-worktree-creation logic globally (every worktree path — CLI
`--worktree`, subagent `isolation: worktree`, background sessions — in every
project with this plugin enabled), so a bug there would break worktree creation
everywhere, not just here. `PostToolUse`/`EnterWorktree` is scoped to worktrees
created via the `EnterWorktree` tool in a live session only — CLI/subagent/
background-session worktrees are not refreshed by this hook, an accepted scope
gap (design doc: `WorktreeCreate` would be the only way to close it, and was
rejected for the reasons above). `tool_response.worktreePath` is used as the
target directory (falls back to `cwd`) — both were confirmed, live, to already
point at the new worktree by the time `PostToolUse` fires. Fails open silently on
every non-actionable case (switch, non-worktree cwd, no remote); on fetch failure
or rebase conflict it reports via `hookSpecificOutput.additionalContext` (never
`decision: block`) — a conflict is always `git rebase --abort`ed first, so the
worktree is never left mid-rebase. Synchronous, not `async: true`: it mutates the
worktree's branch tip, and Claude must not act on the worktree before that settles.

**Every `git` call carries a per-call `timeout: 30_000`** (2026-07-25, CodeRabbit
finding on this PR). The server handles stdin messages synchronously on one thread,
so an unbounded `git` against a slow or unreachable remote would block every later
tool call on this server too, not just this hook. The bound is **per call, not per
fire** — a worst-case fire (`remote set-head`, `remote show origin`, `fetch`,
`rebase`) can still add up to a multiple of it — and a call killed by the timeout
surfaces through the same fetch-failure / rebase-report path as any other git
failure, never as a hang. `interaction_gate` calls no git at all, so the Stop gate
is unaffected by this bound.

**Fail-open toggle (`worktree_refresh`, `default: true`)** — the same fail-open
convention this plugin uses throughout: only the literal `"false"` disables. Read once at
server-start from the `CODING_TOOLBOX_WORKTREE_REFRESH` environment variable
(`.mcp.json`'s own `env` field interpolates `${user_config.worktree_refresh}`
into it) rather than argv, because this hook runs inside the long-lived
`mcp/server.mjs` process, not a fresh per-event
command spawn; official docs confirm `${user_config.*}` substitution works in
"MCP … server configs" (`.mcp.json`), not only in hook `command`/`args` —
verified NOT to work inside an `mcp_tool` hook's own `input` field in
`hooks.json` (that field only substitutes hook-event data like
`${tool_input.file_path}`), which is why the config value is threaded through
`.mcp.json`'s `env` instead. One real consequence: a `worktree_refresh` toggle
change only takes effect on the next server restart (session restart / plugin
reconnect) — the
same lag any `mcp_tool`-hook userConfig value would have, not a bug specific
to this toggle.
