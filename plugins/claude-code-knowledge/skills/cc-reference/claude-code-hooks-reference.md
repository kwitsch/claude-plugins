# Claude Code Hooks — Mechanics Reference

> Harness-optimized knowledge file. Directives, not prose. Source: code.claude.com/docs/en/hooks, verified 2026-06.
> Scope: event catalog, config schema, matchers, I/O, exit codes, decision control, scopes.
> For choosing a handler `type` (command/.sh/.mjs/binary vs http/mcp_tool/prompt/agent), see **hook-handler-selection.md** — not repeated here.

## Model: three nesting levels

1. **Hook event** — lifecycle point (`PreToolUse`, `Stop`, …).
2. **Matcher group** — `matcher` filter for when it fires.
3. **Hook handler** — the `command`/`http`/`mcp_tool`/`prompt`/`agent` that runs.
"Hook" alone = the feature. Multiple matched handlers run in parallel; identical handlers are deduplicated (command by command+args, http by url).

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash",
  "hooks": [ { "type": "command", "if": "Bash(rm *)", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.sh", "args": [] } ] } ] } }
```

## Hook locations / scope

| Location | Scope | Shareable |
|---|---|---|
| `~/.claude/settings.json` | all your projects | no (local machine) |
| `.claude/settings.json` | one project | yes (committable) |
| `.claude/settings.local.json` | one project | no (gitignored) |
| managed policy settings | org-wide | yes (admin) |
| plugin `hooks/hooks.json` | when plugin enabled | yes (bundled) |
| skill/agent frontmatter | while component active | yes (in component) |

- Enterprise `allowManagedHooksOnly` blocks user/project/plugin hooks; force-enabled `enabledPlugins` hooks are exempt.
- File-watcher picks up direct settings edits automatically.

## Event catalog (cadence + when)

Cadence: once/session (SessionStart, SessionEnd), once/turn (UserPromptSubmit, Stop, StopFailure), per tool call (PreToolUse, PostToolUse).

| Event | Fires |
|---|---|
| `SessionStart` | session begins/resumes. command + mcp_tool only |
| `Setup` | `--init-only`, or `--init`/`--maintenance` in `-p`. command + mcp_tool only |
| `InstructionsLoaded` | CLAUDE.md / `.claude/rules/*.md` loaded (eager + lazy). observability only |
| `UserPromptSubmit` | prompt submitted, before processing. can block |
| `UserPromptExpansion` | user slash command expands to prompt, before Claude. can block. catches the `/skill` direct path that `PreToolUse` misses |
| `PreToolUse` | before a tool call. can block / rewrite input |
| `PermissionRequest` | a permission dialog appears |
| `PermissionDenied` | auto-mode classifier denied; `{retry:true}` lets model retry |
| `PostToolUse` | tool succeeded. can feed back / rewrite output |
| `PostToolUseFailure` | tool failed |
| `PostToolBatch` | full parallel batch resolved, before next model call. can stop loop |
| `Notification` | Claude Code sends a notification |
| `MessageDisplay` | while assistant text streams. display-only; can rewrite on-screen text |
| `SubagentStart` / `SubagentStop` | subagent spawned / finished |
| `TaskCreated` / `TaskCompleted` | task created / marked complete. can block |
| `Stop` | Claude finishes responding. can prevent stop |
| `StopFailure` | turn ends on API error. output + exit ignored |
| `TeammateIdle` | agent-team teammate about to idle. can keep working |
| `ConfigChange` | config file changed mid-session. can block (except policy) |
| `CwdChanged` | working dir changed (e.g. `cd`). no matcher |
| `FileChanged` | watched file changed; `matcher` = filenames to watch |
| `WorktreeCreate` / `WorktreeRemove` | worktree created/removed. Create: any non-zero aborts |
| `PreCompact` / `PostCompact` | before/after compaction. Pre can block |
| `Elicitation` / `ElicitationResult` | MCP requests user input / after response |
| `SessionEnd` | session terminates |

## Matcher semantics

`matcher` evaluation by content:

| Value | Treated as |
|---|---|
| `*`, `""`, omitted | match all |
| only `[A-Za-z0-9_|]` | exact string, or `|`-separated exacts (`Edit|Write`) |
| any other char | JavaScript regex (`^Notebook`, `mcp__memory__.*`) |

- MCP tools appear as `mcp__<server>__<tool>`. To match a whole server you MUST append `.*` (`mcp__memory__.*`) — `mcp__memory` is exact-string and matches nothing.
- What the matcher filters per event: tool events → `tool_name`; `SessionStart` → `startup|resume|clear|compact`; `SubagentStart/Stop` → agent type; `PreCompact/PostCompact` → `manual|auto`; `SessionEnd` → end reason; `Notification` → type; `StopFailure` → error type; `InstructionsLoaded` → load reason; `ConfigChange` → source; `UserPromptExpansion` → command name; `Elicitation*` → MCP server.
- No matcher (silently ignored if set): `UserPromptSubmit`, `PostToolBatch`, `Stop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `WorktreeCreate`, `WorktreeRemove`, `CwdChanged`, `MessageDisplay`.

### `if` field (per-handler, tool events only)
- Permission-rule syntax against tool name + args: `Bash(git *)`, `Edit(*.ts)`. Exactly one rule; no `&&`/`||`/list — use separate handlers.
- Only evaluated on `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`; on other events a handler with `if` never runs.
- Bash matching: leading `VAR=val` stripped; each subcommand and `$()`/backtick content checked; patterns more specific than the command name run anyway on `$()`/backtick/`$VAR`. **Fails OPEN on unparseable Bash** → never gate security with `if`; use permission rules.

## Handler types (field tables)

Five `type` values: `command` | `http` | `mcp_tool` | `prompt` | `agent`. **Choice criteria → hook-handler-selection.md.**

Common fields (all types): `type` (req), `if`, `timeout` (defaults: 600s command/http/mcp_tool, 30s prompt, 60s agent; UserPromptSubmit lowers to 30, MessageDisplay to 10), `statusMessage`, `once` (skill-frontmatter only; ignored in settings/agent).

- `command`: `command` (req), `args` (→ exec form), `async`, `asyncRewake` (bg + wake Claude on exit 2), `shell` (`bash`|`powershell`).
- `http`: `url` (req), `headers` (`$VAR` interp), `allowedEnvVars` (required for any interp; unlisted → empty).
- `mcp_tool`: `server` (req, must be connected), `tool` (req), `input` (`${path}` substitution from hook JSON).
- `prompt`/`agent`: `prompt` (req; `$ARGUMENTS` = hook input JSON), `model` (default fast model).

### Exec vs shell form (command)
- `args` present → **exec form**: `command` resolved on PATH, spawned directly; each `args` element = one arg, no shell, no quoting; placeholders substituted as plain strings. Use whenever referencing a path placeholder.
- `args` absent → **shell form**: `sh -c` (macOS/Linux), Git Bash/PowerShell (Windows); enables pipes, `&&`, globs, var expansion. Quote placeholders.
- Windows: `.cmd`/`.bat` shims aren't executables → use shell form, OR exec via `node` + script path (`node` + path works everywhere).
- Path placeholders (also exported as env vars): `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}` (changes per update), `${CLAUDE_PLUGIN_DATA}` (survives updates). Plugin hooks also substitute `${user_config.*}`.

## Input (stdin for command; POST body for http)

Common fields: `session_id`, `transcript_path`, `cwd`, `permission_mode` (not all events), `effort.level` (tool-context events; also `$CLAUDE_EFFORT`), `hook_event_name`. In subagent/`--agent`: `agent_id`, `agent_type`. Only `SessionStart` may receive `model` (not guaranteed; no `$CLAUDE_MODEL`).
Tool events add `tool_name`, `tool_input` (and `tool_use_id` on PreToolUse). `tool_input` shape per tool — Bash `command`; Write `file_path`+`content`; Edit `file_path`+`old_string`+`new_string`+`replace_all`; Read `file_path`+`offset`+`limit`; Glob `pattern`+`path`; Grep `pattern`+`output_mode`+…; WebFetch `url`+`prompt`; Agent `prompt`+`subagent_type`+`model`. PostToolUse Agent `tool_response` carries usage telemetry (`totalTokens`, `usage`, `resolvedModel` [≥v2.1.174], …) for per-subagent cost logging.

## Exit codes (command)

- **0** = success; stdout parsed for JSON (JSON only processed on exit 0). stdout reaches Claude only on `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`; elsewhere debug log only.
- **2** = blocking error; stdout/JSON ignored, stderr fed to Claude. Effect per event below.
- **other** = non-blocking error for most events; transcript shows error notice + first stderr line; action proceeds.
- Pick ONE: exit-code signaling OR exit 0 + JSON. Not both.
- **exit 1 does NOT block** (Unix convention trap). Only exit 2 blocks. Exception: `WorktreeCreate` aborts on any non-zero.

### exit 2 effect per event
Blocks: `PreToolUse` (blocks call), `PermissionRequest` (deny), `UserPromptSubmit` (reject+erase), `UserPromptExpansion` (block expansion), `Stop`/`SubagentStop` (prevent stop), `TeammateIdle` (keep working), `TaskCreated` (rollback), `TaskCompleted` (prevent complete), `ConfigChange` (block, except policy), `PostToolBatch` (stop loop), `PreCompact` (block), `Elicitation` (deny), `ElicitationResult` (decline), `WorktreeCreate` (any non-zero fails).
No-block (stderr shown to Claude/user, or ignored): `PostToolUse`, `PostToolUseFailure`, `PermissionDenied` (use `retry:true`), `StopFailure`, `Notification`, `SubagentStart`, `SessionStart`, `Setup`, `SessionEnd`, `CwdChanged`, `FileChanged`, `PostCompact`, `WorktreeRemove`, `InstructionsLoaded`, `MessageDisplay`.

## HTTP response handling

- 2xx empty = success (≈exit 0 no output); 2xx text = context; 2xx JSON = parsed as JSON output.
- Non-2xx / connection failure / timeout = non-blocking error → proceeds. **Cannot hard-block via status alone** → return 2xx + JSON `decision:"block"` or `permissionDecision:"deny"`.

## JSON output (exit 0)

stdout must be ONLY the JSON object (shell-profile noise breaks parsing). All output strings (incl. `additionalContext`, `systemMessage`) capped at **10,000 chars** → overflow saved to file + preview.

Universal fields: `continue` (false → Claude stops entirely; precedence over decision fields), `stopReason` (shown to user, not Claude), `suppressOutput`, `systemMessage` (user warning), `terminalSequence` (emit notification on your behalf; ≥v2.1.141).

- `terminalSequence` allowlist: OSC `0`/`1`/`2` (titles), `9` (incl `9;4` progress), `99` (Kitty), `777`, bare BEL; ST/BEL terminators. Anything else (CSI, OSC 8/52/1337, colors) → field ignored. Use instead of `/dev/tty` (unavailable to hooks).
- `additionalContext` (inside `hookSpecificOutput` + `hookEventName`): injected as a system reminder at the hook's fire point; Claude reads on next request. Write as factual statements ("This repo uses `bun test`"), not imperative system commands (triggers prompt-injection defenses). Static rules → CLAUDE.md instead. Saved to transcript → stale values (timestamps/SHAs) replay on `--resume` for mid-session events; SessionStart re-runs on resume.

### Decision control by event
| Events | Pattern | Key fields |
|---|---|---|
| UserPromptSubmit, UserPromptExpansion, PostToolUse, PostToolUseFailure, PostToolBatch, Stop, SubagentStop, ConfigChange, PreCompact | top-level `decision` | `decision:"block"`, `reason`. Stop/SubagentStop also take `hookSpecificOutput.additionalContext` (non-error feedback, continues turn) |
| TeammateIdle, TaskCreated, TaskCompleted | exit 2 or `continue:false` | |
| PreToolUse | `hookSpecificOutput` | `permissionDecision` allow/deny/ask/defer + `permissionDecisionReason`; `updatedInput` (full replace); `additionalContext`. Multi-hook precedence deny>defer>ask>allow. `defer` ≥v2.1.89, `-p` only |
| PermissionRequest | `hookSpecificOutput` | `decision.behavior` allow/deny, `decision.updatedInput` |
| PermissionDenied | `hookSpecificOutput` | `retry:true` |
| WorktreeCreate | path return | stdout path (command) / `hookSpecificOutput.worktreePath` (http) |
| Elicitation / ElicitationResult | `hookSpecificOutput` | `action` accept/decline/cancel, `content` |
| MessageDisplay | `hookSpecificOutput` | `displayContent` (on-screen only) |
| SessionStart, Setup, SubagentStart | context only | `additionalContext`; SessionStart also `initialUserMessage`, `watchPaths`, `sessionTitle`, `reloadSkills` |
| WorktreeRemove, Notification, SessionEnd, PostCompact, InstructionsLoaded, StopFailure, CwdChanged, FileChanged | none | side effects only |

Content rewriting: PreToolUse `updatedInput` (before run), PostToolUse `updatedToolOutput` (after), PermissionRequest `decision.updatedInput`, UserPromptSubmit injects `additionalContext` only (can't replace prompt). Redact outbound at PreToolUse, inbound at PostToolUse.

- **PreToolUse: top-level `decision`/`reason` are DEPRECATED** for this event → use `hookSpecificOutput.permissionDecision`/`permissionDecisionReason`. (Deprecated `approve`/`block` → `allow`/`deny`.) PostToolUse/Stop still use top-level `decision`.

## SessionStart specifics
- `CLAUDE_ENV_FILE` (also Setup/CwdChanged/FileChanged): append `export` lines → persist env into later Bash. Use `>>`.
- `reloadSkills:true` re-scans skill/command dirs after SessionStart hooks (skills the hook installed become available same session). `source:"resume"` re-runs on resume.
- Plain stdout already reaches Claude here → context-only hooks can skip JSON.

## Hooks in skills/agents (frontmatter)
- Same config format; scoped to component lifetime; cleaned up on finish. All events supported.
- Subagent `Stop` auto-converts to `SubagentStop`. `once:true` honored ONLY in skill frontmatter.

## /hooks menu & disabling
- `/hooks` = read-only browser; per type `[command|http|mcp_tool|prompt|agent]` + source (`User`/`Project`/`Local`/`Plugin`/`Session`/`Built-in`). Edit JSON to change.
- `disableAllHooks:true` disables all (no per-hook disable). Respects managed hierarchy — only managed-level can disable managed hooks.

## Hard constraints / security
- No controlling terminal (macOS/Linux ≥v2.1.139): no `/dev/tty`. Surface via `systemMessage`; notify via `terminalSequence`.
- Security/irreversible gates → permission system, NOT hooks. `if` and http/mcp_tool fail OPEN (see hook-handler-selection.md).
- `command` holds no state between fires; stateful/expensive init → persistent server via `mcp_tool`/`http`.
- Hook-only `mcp_tool` triggers are config-driven; keep them off the model tool surface to avoid context/token cost.

## Version gates
- v2.1.89 `defer` · v2.1.139 no-TTY · v2.1.141 `terminalSequence` · v2.1.174 Agent `tool_response.resolvedModel`.
