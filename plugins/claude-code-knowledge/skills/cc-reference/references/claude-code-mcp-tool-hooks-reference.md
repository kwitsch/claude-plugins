# Claude Code mcp_tool hooks reference

<!-- verified 2026-08-31 · CURATED: doc-derived + hard-won gotchas. The server-name
     namespacing rule below is now documented (code.claude.com/docs/en/hooks §MCP tool
     hook fields; code.claude.com/docs/en/mcp §Plugin-provided MCP servers) — preserve
     it on any refresh regardless; never regenerate this file wholesale. -->

How to back a hook with an MCP-server tool (`type: "mcp_tool"`). For the general
handler-type choice see `hook-handler-selection.md`; for hook mechanics see
`claude-code-hooks-reference.md`; for MCP config/transports see
`claude-code-mcp-reference.md`.

## When to use mcp_tool vs a command hook

Five hook types exist: `command`, `http`, `mcp_tool`, `prompt`, `agent`. This table
covers the `mcp_tool` vs `command` split; for `http`/`prompt`/`agent` see
`hook-handler-selection.md`.

| Situation                                                                                                                                                            | Handler                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Non-blocking, mid-session (`PreToolUse`/`PostToolUse`/`Stop`/`SubagentStop`/`Elicitation`/`ElicitationResult`/…): inject context, observe, reuse a live runtime/deps | **`mcp_tool`** (preferred)                                                |
| Fires before the server connects (`SessionStart`, `Setup`)                                                                                                           | command (`.mjs`) — server not up yet → `mcp_tool` fails open on first run |
| Fail-closed hard gate (must deny/abort, needs exit 2)                                                                                                                | command — `mcp_tool` has no exit-2 path, fails open if server down        |
| Must hard-deny an MCP server elicitation (`Elicitation` exit-2 = deny; `ElicitationResult` exit-2 = block/decline)                                                   | command — `mcp_tool` can only soft-deny via returned JSON                 |
| Must-fire side-effect (snapshot, state-write other hooks read)                                                                                                       | command — `mcp_tool` silently no-ops when the server is down              |

`mcp_tool` requires an **already-connected** server; the hook never triggers a
connection flow. `SessionStart` and `Setup` do accept `mcp_tool` hooks, but servers
typically aren't connected yet when they fire, so expect "not connected" errors on
those events.

**Fail-open is two-fold:** a _non-blocking error_ (execution continues regardless)
occurs both when the named server is **not connected** AND when the tool returns
`isError: true`. So a tool that signals an error cannot block — to deny/abort, return
a valid hook-decision JSON (see _Output contract_), never `isError`.

## Hook fields

| Field    | Required | Notes                                                                                                                                                                                                             |
| -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`   | yes      | `"mcp_tool"`                                                                                                                                                                                                      |
| `server` | yes      | Name of a **connected** server — see _Server name_ below                                                                                                                                                          |
| `tool`   | yes      | Tool to call on that server                                                                                                                                                                                       |
| `input`  | no       | Arguments object; string values support `${path}` substitution from the hook JSON (e.g. `${tool_input.file_path}`, `${session_id}`, `${cwd}`). Omit → the tool receives the full hook event JSON as its arguments |

Common fields apply (`if`, `statusMessage`, and `timeout`). Default `timeout` is 600 s
for most events; `UserPromptSubmit`, `PreModelSwitch`, and `PostModelSwitch` lower the
default to 30 s; `MessageDisplay` lowers it to 10 s. Set the field explicitly when you
need a different value.

## Server name — the namespacing rule (gotcha)

The `server` value is matched against the server's **connected runtime name**, not
necessarily the key you wrote in config.

- **Plugin-bundled server:** it connects as `plugin:<plugin-name>:<server-key>`
  (verify with `claude mcp list` or `/mcp` — e.g. `plugin:context7:context7`).
  A hook in that same plugin MUST set
  `"server": "plugin:<plugin-name>:<server-key>"`. Using the bare `.mcp.json` key
  resolves to `MCP server '<key>' not connected` on **every** fire.
- **Settings/user server** (defined directly in settings, not a plugin): use the
  bare key as written.
- The `.mcp.json` server key and the server's self-reported `serverInfo.name` stay
  bare; only the hook's `server` _reference_ is namespaced.

Hook-tool _matchers_ (a different surface) use the sanitized tool name
`mcp__plugin_<plugin>_<server-key>__<tool>` (chars outside `[A-Za-z0-9_-]` → `_`;
hyphens preserved, e.g. `mcp__plugin_my-plugin_database-tools__query`); the `server`
field uses the colon-form connected name.

## Output contract

The tool's **text content is treated exactly like command-hook stdout**: if it is
valid JSON it is parsed as the hook decision; otherwise it is shown as plain text.
So an `mcp_tool` hook expresses any decision via the JSON it returns — it can never
emit exit code 2.

- Return the same `hookSpecificOutput` shape a command hook would print, e.g. for
  `PreToolUse`: `{"hookSpecificOutput":{"hookEventName":"PreToolUse",
"permissionDecision":"allow","updatedInput":{…}}}` — `updatedInput` works
  identically (full-replace before the tool runs).
- Self-contained servers should return both `content:[{type:"text",text:JSON}]`
  (the parsed surface) and `structuredContent` (the same object).
- Soft-block only: on block-capable events it can return `permissionDecision:"deny"`
  / `decision:"block"`, but if the server is down it **fails open** (no block).

## Self-contained plugin server pattern

Back the hook with a plugin-local server (no `bin/`, no wrapper):

```
plugins/<name>/
  mcp/server.mjs   # zero-dep MCP stdio server (chmod +x; bun-preferred, node fallback)
  .mcp.json        # { "mcpServers": { "<name>-hooks": { "command": "${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs" } } }
  hooks/hooks.json # { "type":"mcp_tool", "server":"plugin:<name>:<name>-hooks", "tool":"<tool>" }
```

- `mcp/server.mjs` MUST be executable — a non-executable server silently fails to
  start, and the `mcp_tool` hook then fails open.
- Transport: newline-delimited JSON-RPC 2.0; stdout = JSON-RPC only, logs → stderr.

## Version notes

- Server-name namespacing (`plugin:<plugin>:<server-key>`) confirmed via
  `claude mcp list` on the running CLI, and via the official docs' MCP tool
  hook fields table and Plugin-provided MCP servers section; the bare-key
  form does not match a plugin-bundled server.
- `agent` hook type added (5th type alongside `command`, `http`, `mcp_tool`, `prompt`);
  spawns an agentic verifier with tool access. Supported on the same events as
  `prompt` (see support-matrix in `claude-code-hooks-reference.md`).
  Not supported on `SessionStart`, `Setup`, `MessageDisplay`, or other async-only events.
- `Elicitation` and `ElicitationResult` events added: fire during MCP server elicitation
  flows. `mcp_tool` hooks can fire on both and soft-deny via returned JSON. Command hooks
  with exit 2 hard-deny: `Elicitation` exit-2 = deny the elicitation; `ElicitationResult`
  exit-2 = block the response (action becomes decline). On both events, an exit-2 hook's
  `hookSpecificOutput` is ignored (mcp_tool can't emit exit-2 anyway, so mcp_tool can only
  soft-deny these events).
- version >= 2.1.251: `PreModelSwitch`/`PostModelSwitch` events exist and accept
  `mcp_tool` hooks (command/http/mcp_tool only — no `prompt`/`agent` on either); the
  `mcp_tool` timeout default of 30 s applies to both, same as `UserPromptSubmit`.
