# CLAUDE.md — coding-toolbox

Plugin that injects and enforces "golden behavior rules" via three hooks. `SessionStart`
content is baked in (`hooks/SessionStart.md`) with no runtime state. `PreToolUse` and
`Stop` are backed by one self-contained MCP server (`mcp/server.mjs`): `PreToolUse`
carries a session-lifetime call counter throttling the reminder; `Stop` is a stateless
mechanical gate for the Interaction axis. No userConfig.

## Hook design (do not "fix" without reading this)

- **SessionStart → `command` hook: `cat` + `args:["${CLAUDE_PLUGIN_ROOT}/hooks/SessionStart.md"]`.**
  SessionStart fires *before* the MCP server connects, so an `mcp_tool` hook would fail
  open. `args` present → exec form: `cat` is spawned with the path as its argument and
  writes the file to stdout; plain stdout reaches Claude at SessionStart (no JSON wrapper
  needed). No matcher → fires on startup, resume, and compact. Do NOT replace this with a
  `.mjs` handler on the premise that "args is dropped" — it is not (cc-reference,
  `claude-code-hooks-reference.md` "Exec vs shell form": *use exec form whenever
  referencing a path placeholder*; the shipped cave-context plugin uses this exact hook).
  (`.claude/rules/hooks-mcp-server.md`, `.claude/rules/hooks-mcp-tool-event-matrix.md`)
- **PreToolUse → `mcp_tool` hook: `server: "plugin:coding-toolbox:coding-toolbox-hooks"`,
  `tool: "golden_rules_reminder"`** (server registered in `.mcp.json` as
  `coding-toolbox-hooks`; the hook's `server` field must use the runtime-namespaced
  `plugin:coding-toolbox:coding-toolbox-hooks` form, not the bare `.mcp.json` key — see
  `.claude/rules/hooks-mcp-server.md`). Matcher `Edit|Write|NotebookEdit|Bash` —
  deliberately **excludes** `Task`/`Agent`: the reminder must not fire before subagent
  dispatch (2026-07-01 decision), so those names were dropped from the matcher entirely
  rather than special-cased in the handler — the hook never fires for that tool, no
  MCP round-trip spent. `mcp/server.mjs` keeps a module-level `callCount` for the
  process lifetime (the server stays connected for the whole session) and returns
  `additionalContext` with the reminder text only on every 10th matched call
  (`callCount % 10 === 0`); every other call returns `{}` (no opinion, fail-open
  no-op — consistent with `mcp_tool`'s soft-block-only semantics). This throttling is
  exactly the kind of per-call dynamic state a static `cat`'d JSON file cannot express,
  which is why this hook — unlike SessionStart — now uses `mcp_tool`: do not revert it
  to a `command` hook over a static file, that would drop both the throttle and the
  tool exclusion.
- **Stop → `mcp_tool` hook (no matcher — `Stop` ignores it): `tool: "interaction_gate"`**
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
  add a counter here, unlike the PreToolUse tool.

## Skill design (`fresh-branch`)

Single inline synchronous bash script (no MCP server, no subagent — same idiom
as `branch-management:new-branch`), self-detecting worktree state via `git
rev-parse --git-dir` vs `--git-common-dir`. Deliberately independent of
`branch-management` — supports a custom base/upstream and a branch+base pair,
which `new-branch` does not. Auto-stashes (`git stash push -u`) and pops
unconditionally around both paths, including the refresh-only path (now
universal for zero-argument invocations, not just inside a worktree —
2026-07-02, extended same day per user request) that creates no new branch —
never silently drops a stash on a pop conflict (exit `8`, reported). The
non-worktree branch-name collision check runs *before* any stash or checkout so
that path never has to unwind a stash from the wrong branch. See `skills/fresh-branch/SKILL.md`'s parameter table for the full worktree × arg-count truth table.

## Tests

`test/coding-toolbox/test.bats` — manifest/registration invariants, content coverage,
hook wiring (SessionStart command, PreToolUse `mcp_tool`, Stop `mcp_tool`), the
SessionStart end-to-end command test, an end-to-end JSON-RPC driver against
`mcp/server.mjs` proving the PreToolUse throttle (calls 1–9 return `{}`, call 10
returns the reminder), and one proving the Stop gate blocks on a bare trailing `?`
and allows through otherwise.
Run: `BATS_LIB_PATH=/usr/lib/bats bats test/coding-toolbox/`
