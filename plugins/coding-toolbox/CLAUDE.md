# CLAUDE.md — coding-toolbox

Plugin that injects "golden behavior rules" via two hooks. `SessionStart` content is
baked in (`hooks/SessionStart.md`) with no runtime state. `PreToolUse` is backed by a
self-contained MCP server (`mcp/server.mjs`) that carries one piece of session-lifetime
runtime state: a call counter throttling the reminder. No userConfig.

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

## Tests

`test/coding-toolbox/test.bats` — manifest/registration invariants, content coverage,
hook wiring (SessionStart command + PreToolUse `mcp_tool`), the SessionStart
end-to-end command test, and an end-to-end JSON-RPC driver against `mcp/server.mjs`
proving the throttle (calls 1–9 return `{}`, call 10 returns the reminder).
Run: `BATS_LIB_PATH=/usr/lib/bats bats test/coding-toolbox/`
