---
paths:
  - "plugins/*/hooks/hooks.json"
doc_type: claude_code_knowledge
topic: hook_handler.mcp_tool.event_compatibility
schema_version: 1
parse_priority: machine_first
human_readability: secondary
last_verified: 2026-06-13
sources:
  official_hooks_reference: https://code.claude.com/docs/en/hooks
  changelog: https://code.claude.com/docs/en/release-notes
  issue_24788: https://github.com/anthropics/claude-code/issues/24788
  issue_34713: https://github.com/anthropics/claude-code/issues/34713
  community_introduced_version: https://github.com/luongnv89/claude-howto/blob/main/06-hooks/README.md
confidence_levels: [documented, inferred, community, unverified]
status_values: [full, limited]
---

# Claude Code Hook Handler `type:"mcp_tool"` — Event Compatibility Matrix

PURPOSE: Decide, per hook event, whether the `mcp_tool` handler is fully usable
(`full`) or constrained (`limited`), and why. Optimized for harness/agent parsing.
The canonical machine-readable record is the `events` array in the JSON block under
`## CANONICAL_SPEC`. All prose is derived from that block; on conflict, the JSON wins.

> Repo note: this file is the canonical per-event reference cited by
> `.claude/rules/hooks-mcp-server.md`. When choosing a handler type, lean only on
> `confidence: documented` rows; treat `inferred` / `unverified` / `community` rows
> as hypotheses, not fact (see `## VALIDATION_FLAGS`).

## GLOBAL_MECHANICS

```json
{
  "handler_type": "mcp_tool",
  "required_fields": ["server", "tool"],
  "optional_fields": ["input"],
  "input_substitution": "string values support ${path} from hook JSON input, e.g. ${tool_input.file_path}, ${hook_event_name}, ${prompt}",
  "introduced_version": "2.1.118",
  "introduced_version_confidence": "community",
  "output_treated_as": "command_hook_stdout",
  "output_decision_path": "tool text content parsed as JSON output if valid, else shown as plain text",
  "failure_mode": "non_blocking_only",
  "failure_triggers": ["server_not_connected", "tool_returns_isError_true"],
  "has_exit_code_path": false,
  "has_exit_code_path_confidence": "inferred",
  "requires_preconnected_server": true,
  "triggers_oauth_or_connect_flow": false,
  "timeout_default_s": 600,
  "timeout_override_userpromptsubmit_s": 30,
  "timeout_override_messagedisplay_s": 10,
  "env_file_access": false,
  "env_file_note": "CLAUDE_ENV_FILE is command-hook only; mcp_tool cannot persist env vars",
  "if_field_scope": ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PermissionDenied"],
  "output_char_cap": 10000,
  "hard_gate_suitability": false,
  "hard_gate_reason": "on server failure/error the action proceeds (non-blocking); cannot enforce a deny"
}
```

KEY_INVARIANT: `mcp_tool` can express a decision ONLY via JSON it returns as text.
It cannot emit exit code 2. Therefore:

- Events whose block path is JSON (top-level `decision` or `hookSpecificOutput`) => `mcp_tool` can block => `full`.
- Events whose ONLY granular block path is exit code 2 => `mcp_tool` cannot do the granular block; at best `{"continue": false}` (coarse, stops the whole turn/agent) => `limited`.

## CANONICAL_SPEC

```json
{
  "events": [
    {"event": "PreToolUse",          "category": "tool",        "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:hookSpecificOutput.permissionDecision(allow|deny|ask|defer)", "additional_context": true,  "rewrite": "updatedInput", "timeout_s": 600, "trigger": "auto",   "limitation": null, "confidence": "documented"},
    {"event": "PostToolUse",         "category": "tool",        "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:decision=block", "additional_context": true, "rewrite": "updatedToolOutput", "timeout_s": 600, "trigger": "auto", "limitation": null, "confidence": "documented"},
    {"event": "PostToolUseFailure",  "category": "tool",        "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:decision=block", "additional_context": true, "rewrite": null, "timeout_s": 600, "trigger": "semi", "limitation": null, "confidence": "documented"},
    {"event": "PostToolBatch",       "category": "tool",        "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:decision=block (stops loop before next model call)", "additional_context": true, "rewrite": null, "timeout_s": 600, "trigger": "semi", "limitation": null, "confidence": "documented"},
    {"event": "PermissionRequest",   "category": "tool",        "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:decision.behavior(allow|deny)", "additional_context": false, "rewrite": "decision.updatedInput", "timeout_s": 600, "trigger": "semi", "limitation": null, "confidence": "documented"},
    {"event": "PermissionDenied",    "category": "tool",        "supported": true, "status": "full",    "block_capable": false,    "block_mechanism": "json:hookSpecificOutput.retry=true (retry, not block)", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": null, "confidence": "documented"},
    {"event": "UserPromptExpansion", "category": "turn",        "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:decision=block", "additional_context": true, "rewrite": null, "timeout_s": 600, "trigger": "semi", "limitation": null, "confidence": "documented"},
    {"event": "Stop",                "category": "turn",        "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:decision=block (continues turn) + additionalContext feedback", "additional_context": true, "rewrite": null, "timeout_s": 600, "trigger": "auto", "limitation": null, "confidence": "documented"},
    {"event": "SubagentStop",        "category": "turn",        "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:decision=block + additionalContext", "additional_context": true, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": null, "confidence": "documented"},
    {"event": "ConfigChange",        "category": "lifecycle",   "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:decision=block (except policy_settings)", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": null, "confidence": "documented"},
    {"event": "PreCompact",          "category": "lifecycle",   "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:decision=block", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": null, "confidence": "documented"},
    {"event": "Elicitation",         "category": "mcp",         "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:hookSpecificOutput.action(accept|decline|cancel)", "additional_context": false, "rewrite": "content", "timeout_s": 600, "trigger": "manual", "limitation": null, "confidence": "documented", "note": "ideal fit: fires during MCP tool execution, server guaranteed connected"},
    {"event": "ElicitationResult",   "category": "mcp",         "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:hookSpecificOutput.action(accept|decline|cancel)", "additional_context": false, "rewrite": "content", "timeout_s": 600, "trigger": "manual", "limitation": null, "confidence": "documented"},
    {"event": "SubagentStart",       "category": "lifecycle",   "supported": true, "status": "full",    "block_capable": false,    "block_mechanism": "context_only", "additional_context": true, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": null, "confidence": "documented"},
    {"event": "Notification",        "category": "side_effect", "supported": true, "status": "full",    "block_capable": false,    "block_mechanism": "none", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": null, "confidence": "documented"},
    {"event": "PostCompact",         "category": "side_effect", "supported": true, "status": "full",    "block_capable": false,    "block_mechanism": "none", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": null, "confidence": "documented"},
    {"event": "SessionEnd",          "category": "side_effect", "supported": true, "status": "full",    "block_capable": false,    "block_mechanism": "none", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "auto", "limitation": null, "confidence": "documented"},
    {"event": "WorktreeRemove",      "category": "side_effect", "supported": true, "status": "full",    "block_capable": false,    "block_mechanism": "none", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": null, "confidence": "documented"},
    {"event": "InstructionsLoaded",  "category": "side_effect", "supported": true, "status": "full",    "block_capable": false,    "block_mechanism": "none (async observability)", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "auto", "limitation": null, "confidence": "documented"},

    {"event": "SessionStart",        "category": "lifecycle",   "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "context_only", "additional_context": true, "rewrite": null, "timeout_s": 600, "trigger": "auto", "limitation": "servers usually not connected yet on first run => expect not-connected non-blocking error; no CLAUDE_ENV_FILE access", "confidence": "documented"},
    {"event": "Setup",               "category": "lifecycle",   "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "context_only", "additional_context": true, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": "fires before a session/servers exist (--init/--maintenance) => server almost certainly not connected; no CLAUDE_ENV_FILE access", "confidence": "documented"},
    {"event": "UserPromptSubmit",    "category": "turn",        "supported": true, "status": "limited", "block_capable": true,     "block_mechanism": "json:decision=block + additionalContext", "additional_context": true, "rewrite": "none (context only)", "timeout_s": 30, "trigger": "auto", "limitation": "functionally full, but timeout reduced to 30s and the hook blocks model processing; an MCP round-trip on every prompt is a latency/cost choice", "confidence": "documented"},
    {"event": "MessageDisplay",      "category": "display",     "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "json:hookSpecificOutput.displayContent (display-only)", "additional_context": false, "rewrite": "displayContent", "timeout_s": 10, "trigger": "manual", "limitation": "10s timeout, runs per streamed line-batch, display-only => MCP round-trip per batch is impractical", "confidence": "documented"},
    {"event": "CwdChanged",          "category": "side_effect", "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "none", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "semi", "limitation": "primary documented purpose is reactive env management via CLAUDE_ENV_FILE, which mcp_tool cannot use; works only as a side-effect trigger", "confidence": "documented"},
    {"event": "FileChanged",         "category": "side_effect", "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "none", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": "same CLAUDE_ENV_FILE gap as CwdChanged; usable as a reaction trigger only", "confidence": "documented"},
    {"event": "StopFailure",         "category": "turn",        "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "none", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": "output and exit code are ignored (true for all handler types); mcp_tool can only fire as a side-effect, returns nothing usable", "confidence": "documented"},
    {"event": "TaskCreated",         "category": "task",        "supported": true, "status": "limited", "block_capable": "coarse", "block_mechanism": "exit2 (granular rollback) UNAVAILABLE; only json:continue=false (stops whole turn)", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "semi", "limitation": "granular task-creation rollback needs exit code 2, which mcp_tool cannot emit; only the coarse continue:false stop is possible", "confidence": "inferred"},
    {"event": "TaskCompleted",       "category": "task",        "supported": true, "status": "limited", "block_capable": "coarse", "block_mechanism": "exit2 UNAVAILABLE; only json:continue=false", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "semi", "limitation": "same as TaskCreated: no granular block, only coarse continue:false", "confidence": "inferred"},
    {"event": "TeammateIdle",        "category": "task",        "supported": true, "status": "limited", "block_capable": "coarse", "block_mechanism": "exit2 UNAVAILABLE; only json:continue=false", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": "granular keep-working block needs exit2; mcp_tool only has coarse continue:false; requires agent teams", "confidence": "inferred"},
    {"event": "WorktreeCreate",      "category": "lifecycle",   "supported": true, "status": "limited", "block_capable": "uncertain", "block_mechanism": "command:stdout path / http:worktreePath; any non-zero exit aborts creation", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": "drives creation via returned path + exit-code failure; mcp_tool failure is non-blocking so it cannot abort creation, and reliable path return via the text-as-stdout channel is unconfirmed", "confidence": "unverified"}
  ]
}
```

## DERIVED_LISTS

### LIST_1_FULL (problemlos)

PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, PermissionRequest,
PermissionDenied, UserPromptExpansion, Stop, SubagentStop, ConfigChange, PreCompact,
Elicitation, ElicitationResult, SubagentStart, Notification, PostCompact, SessionEnd,
WorktreeRemove, InstructionsLoaded.

### LIST_2_LIMITED (mit Einschränkung => siehe `limitation` im CANONICAL_SPEC)

SessionStart, Setup, UserPromptSubmit, MessageDisplay, CwdChanged, FileChanged,
StopFailure, TaskCreated, TaskCompleted, TeammateIdle, WorktreeCreate.

## VALIDATION_FLAGS

```json
{
  "not_sufficiently_validated": [
    {
      "id": "introduced_version_2_1_118",
      "claim": "mcp_tool handler introduced in v2.1.118",
      "status": "community",
      "detail": "Stated only by community guides (luongnv89, morphllm), not in the official hooks reference read on 2026-06-13."
    },
    {
      "id": "issue_24788_scope",
      "claim": "additionalContext dropped after MCP tool calls",
      "status": "different_subject",
      "detail": "Issue #24788 concerns type:command hooks matching mcp__* tools (PostToolUse), tagged platform:windows. It does NOT describe the mcp_tool handler. No official confirmation that the mcp_tool handler itself drops additionalContext."
    },
    {
      "id": "issue_34713_scope",
      "claim": "false 'hook error' labels on MCP-tool hooks",
      "status": "different_subject",
      "detail": "Issue #34713 concerns type:command (.mjs) hooks matching mcp__* tools showing false hook-error labels despite exit 0 + valid JSON. Not the mcp_tool handler."
    },
    {
      "id": "task_block_granularity",
      "claim": "mcp_tool cannot granularly block TaskCreated/TaskCompleted/TeammateIdle/WorktreeCreate",
      "status": "inferred",
      "detail": "Logically derived from (a) mcp_tool has no exit-code path and (b) these events' granular block path is exit code 2. Not stated verbatim in docs. Target of the test harness."
    },
    {
      "id": "alt_context_gap",
      "claim": "hook results may be silently discarded in subagent/MCP/worktree execution paths",
      "status": "community",
      "detail": "From a community catalogue (dev.to). Not official, not specific to the mcp_tool handler."
    }
  ]
}
```

## AGENT_USAGE_NOTES

- Treat `confidence: inferred|unverified` rows as hypotheses; verify with the harness
  (`mcp-tool-hook-harness`, scenarios `emit_continue_false` for task events,
  `emit_pretool_deny`/`emit_block`/`emit_context` for tool/turn events).
- For any hard allow/deny enforcement, do NOT use `mcp_tool`; use the permission
  system or a `command` hook with exit code 2.
- For `SessionStart`/`Setup`, gate logic on a connectivity check and tolerate the
  first-run not-connected error.
