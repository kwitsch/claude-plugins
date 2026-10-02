---
paths:
  - "plugins/*/hooks/hooks.json"
---

# Rule: hooks.json authoring (repo conventions)

Repo-specific conventions only. For the generic reference — events and matchers, stdin JSON, JSON output, exit codes — use the cc-reference hooks skill or <https://code.claude.com/docs/en/hooks> · <https://code.claude.com/docs/en/plugins>.

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

| Variable                | Value                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `${CLAUDE_PLUGIN_ROOT}` | Plugin install directory — **changes on each plugin update**. Use for bundled scripts. |
| `${CLAUDE_PLUGIN_DATA}` | Persistent data dir — survives plugin updates. Use for deps and runtime state.         |
| `${CLAUDE_PROJECT_DIR}` | Project's `.claude/` parent directory.                                                 |

## Exec form vs shell form

- **Exec form** (`command` + `args: []`): each element is passed verbatim — no shell tokenization, so paths with spaces or special characters work without quoting. Use it when passing arguments (`"args": ["--session-start-hook"]`), when the target is not executable (`"command": "cat", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/SessionStart.md"]`), and whenever a hook references `${user_config.*}` (exec-form only, v2.1.207+; a shell-form reference errors instead of running).
- **Shell form** (no `args`): needed for pipes and `&&`. Double-quote every path placeholder (`bash "${CLAUDE_PLUGIN_ROOT}/hooks/x.sh"`).
- **Accepted exception:** a bare executable `.mjs` path as the whole `command`, no `args` — the repo convention for `.mjs` hooks (next section). Do not "fix" it to exec form.

## Command-hook fields

- `type`: `command` `http` `mcp_tool` `prompt` `agent`.
- `command` (required): executable or shell string. `args`: see above.
- `if`: permission-rule syntax filter — only on tool events. One rule per handler, no `&&`/`||`. Example: `"Bash(git *)"` or `"Edit(*.ts)"`.
- `timeout`: seconds. Default 600 (command/http/mcp_tool; 30 on UserPromptSubmit/PreModelSwitch/PostModelSwitch, 10 on MessageDisplay), 30 (prompt), 60 (agent).
- `async`: `true` = fire-and-forget; result delivered as context on the next turn. `asyncRewake`: `true` = background + wakes the model on exit 2.
- `shell`: `bash` or `powershell` (shell form only). `statusMessage`: spinner text.

### `.mjs` hook commands

`.mjs` hook files are executable (see hooks-executable rule) and are invoked directly by Claude Code. Do NOT prefix them with `node`.

**Correct:**

```json
{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/my-hook.mjs" }
```

**Wrong:**

```json
{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/my-hook.mjs" }
```

When writing or reviewing `hooks.json`, remove any leading `node` (or `node --input-type=module`) from `.mjs` command entries.

### `mcp_tool` hooks

Fields: `server` (required — the **runtime-namespaced** name `plugin:<plugin-name>:<name>-hooks`, not the bare `.mcp.json` key) and `tool` (required). Set an explicit `input` too (omitting it delivers `arguments: {}`). Choose command vs `mcp_tool` and see the pre-connect fail-open, soft-block-only and `input` details in the **hooks-mcp-server** rule and the per-event **hooks-mcp-tool-event-matrix**.

```json
{
  "type": "mcp_tool",
  "server": "plugin:<plugin-name>:<name>-hooks",
  "tool": "<tool>"
}
```

## Output pitfalls

- `PreToolUse` `updatedInput` replaces the **entire** input object — include unchanged fields too.
- Plain stdout reaches Claude only on `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart` and `PostModelSwitch`; every other event needs a JSON envelope (`hookSpecificOutput.additionalContext`).

## Best practices

- **Fail open**: exit 0 with no output on unexpected input — never strand the user.
- **`if` filter early**: use `if` on the handler to avoid spawning the process for unrelated tool calls.
- **Keep SessionStart hooks fast**: they run on every session.
- **`async` for side effects**: test runs, linting, notifications — don't block the agentic loop for work that doesn't need to gate the next tool call.
- **Shell hooks**: `jq` primary, `node`/`python3` fallback, consistent with existing hooks in this repo; fail open when neither is available. `tool_response` can be large — extract only the fields you need.
