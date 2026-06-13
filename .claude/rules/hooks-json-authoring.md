---
paths:
  - "plugins/*/hooks/hooks.json"
---

# Rule: hooks.json authoring reference

Sources: https://code.claude.com/docs/en/hooks · https://code.claude.com/docs/en/plugins

## File structure

```json
{
  "description": "Optional top-level description of what these hooks do",
  "hooks": {
    "EVENT_NAME": [
      {
        "matcher": "ToolName|OtherTool",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/my-hook.mjs",
            "if": "Edit(*.ts)",
            "timeout": 60,
            "statusMessage": "Checking...",
            "async": false
          }
        ]
      }
    ]
  }
}
```

## Plugin path variables

| Variable | Value |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | Plugin install directory — **changes on each plugin update**. Use for bundled scripts. |
| `${CLAUDE_PLUGIN_DATA}` | Persistent data dir — survives plugin updates. Use for deps and runtime state. |
| `${CLAUDE_PROJECT_DIR}` | Project's `.claude/` parent directory. |

**Use exec form** (`"args": []`) when referencing path variables — each element is passed verbatim, no shell tokenization, so paths with spaces or special characters work without quoting. Omit `args` when you need pipes or `&&`.

## Hook command fields

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `command` `http` `mcp_tool` `prompt` `agent` |
| `command` | yes | Executable or shell string |
| `args` | no | Exec form when present (no shell). Omit for shell form (pipes, `&&`). |
| `if` | no | Permission-rule syntax filter — only on tool events. One rule per handler, no `&&`/`\|\|`. Example: `"Bash(git *)"` or `"Edit(*.ts)"` |
| `timeout` | no | Seconds. Default: 600 (command/http/mcp_tool), 30 (prompt), 60 (agent) |
| `statusMessage` | no | Spinner text while hook runs |
| `shell` | no | `bash` or `powershell` (shell form only) |
| `async` | no | `true` = fire-and-forget. Result delivered as context on next turn. |
| `asyncRewake` | no | `true` = background + wakes model on exit 2 |

**`.mjs` hooks**: executable, invoked directly — do NOT prefix with `node`. See hooks-executable rule and hooks-json-mjs-command rule.

### `mcp_tool` hooks

A `mcp_tool` hook calls a tool on an **already-connected** MCP server instead of
running a command. Fields (besides the common ones): `server` (required — name
of a configured, connected MCP server; the hook never triggers a connection
flow) and `tool` (required — the tool to call).

Two consequences: it only fires reliably for **mid-loop** events
(`PreToolUse`/`PostToolUse`), and if the server is down it **fails open** (silent
no-op). So `mcp_tool` is for **non-blocking** hooks only — early-lifecycle hooks
and fail-closed guards stay command hooks. The preferred shape (a self-contained
plugin-local `mcp/server.mjs`, bun-preferred with node fallback) is documented in
the **hooks-mcp-server** rule.

```json
{
  "type": "mcp_tool",
  "server": "<name>-hooks",
  "tool": "<tool>"
}
```

## Events reference

| Event | Matcher support | Can block | Notes |
|---|---|---|---|
| `SessionStart` | `startup` `resume` `clear` `compact` | No | Load context; set `sessionTitle`; `reloadSkills: true` |
| `PreToolUse` | tool name | **Yes** (exit 2) | Can allow/deny/modify tool input |
| `PostToolUse` | tool name | No | Tool already ran; stderr shown to Claude |
| `PostToolUseFailure` | tool name | No | Tool already failed |
| `PostToolBatch` | — (ignored) | Yes | Stops loop before next model call |
| `PermissionRequest` | tool name | Yes | Override permission dialog |
| `PermissionDenied` | tool name | No | Use `hookSpecificOutput.retry: true` to allow retry |
| `UserPromptSubmit` | — (ignored) | Yes | Blocks prompt; erases it on block |
| `Stop` | — | Yes | Prevents Claude stopping |
| `SubagentStart` | agent type name | No | Notification only |
| `SubagentStop` | agent type name | No | Notification only |
| `PreCompact` | `manual` `auto` | Yes | Block compaction |
| `PostCompact` | `manual` `auto` | No | |
| `FileChanged` | — | No | Async file watch events |
| `CwdChanged` | — | No | |

**MCP tools** match as `mcp__<server>__<tool>`. Use `mcp__server__.*` to match all tools from a server.

## stdin JSON (common fields)

```json
{
  "session_id": "abc123",
  "transcript_path": "/.../.claude/projects/.../session.jsonl",
  "cwd": "/project/root",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/path/to/file", "content": "..." },
  "tool_response": { "filePath": "...", "success": true }
}
```

`tool_response` only present in `PostToolUse`. `agent_id` + `agent_type` present when running inside a subagent.

## JSON output

### Universal fields (all events)

```json
{
  "continue": false,         // stops Claude entirely; takes precedence over event decisions
  "stopReason": "...",       // shown to USER (not Claude) when continue: false
  "suppressOutput": false,   // hide stdout from transcript (still in debug log)
  "systemMessage": "..."     // warning shown to user
}
```

### PreToolUse — control tool execution

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask|defer",
    "permissionDecisionReason": "shown to user (allow/ask) or to Claude (deny)",
    "updatedInput": { "file_path": "...", "content": "..." },
    "additionalContext": "injected into Claude context (ignored when decision is deny)"
  }
}
```

`updatedInput` replaces the **entire** input object — include unchanged fields too.

### PostToolUse / Stop — inject context or block

```json
{
  "decision": "block",
  "reason": "Shown to Claude as feedback",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Injected into Claude's context"
  }
}
```

### SessionStart — load context

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Context injected for this session",
    "sessionTitle": "my-feature-branch",
    "reloadSkills": true
  }
}
```

Plain stdout also reaches Claude for SessionStart (no JSON wrapper needed for context-only hooks).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Block (for blockable events) |
| other non-zero | Failure — stderr shown per event (see table above) |

## Best practices

- **Fail open**: exit 0 with no output on unexpected input — never strand the user.
- **Parse only what you need**: `tool_response` can be large; extract fields with `jq`.
- **`if` filter early**: use `if` on the handler to avoid spawning the process for unrelated tool calls.
- **Keep SessionStart hooks fast**: they run on every session.
- **`async` for side effects**: test runs, linting, notifications — don't block the agentic loop for work that doesn't need to gate the next tool call.
- **`jq` primary, `node`/`python3` fallback**: consistent with existing hooks in this repo. Fail open when neither available.
- **Exec form for plugin paths**: `"args": []` prevents tokenization surprises on paths with spaces.
