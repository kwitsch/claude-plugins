# CLAUDE.md — coding-toolbox

Plugin that injects "golden behavior rules" via two hooks. Content is baked in
(`hooks/SessionStart.md`, `hooks/PreToolUse.json`); no MCP server, no Node handler, no
userConfig, no runtime state.

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
- **PreToolUse → `command` hook: `cat` + `args:["${CLAUDE_PLUGIN_ROOT}/hooks/PreToolUse.json"]`** — NOT `mcp_tool`, NOT a `.mjs` handler. On exit 0 a command hook's stdout is parsed as JSON (cc-reference, `claude-code-hooks-reference.md` "Exit codes"/"JSON output"), so `cat PreToolUse.json` IS the hook output: the file holds a complete `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"…"}}` payload — `additionalContext` only, never a `permissionDecision` (which would interfere with the permission flow). An MCP server or a `.mjs` wrapper for static text adds a file for zero dynamic value, against the decision tree and this plugin's fewest-files philosophy. A bats tripwire validates the payload shape — do not add a handler, a `permissionDecision`, or flip to `mcp_tool`.

## Tests

`test/coding-toolbox/test.bats` — manifest/registration invariants, content coverage,
hook wiring, end-to-end command tests (both hooks `cat` their file), and the
additionalContext-JSON anti-flip tripwire.
Run: `BATS_LIB_PATH=/usr/lib/bats bats test/coding-toolbox/`
