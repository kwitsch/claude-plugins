---
paths:
  - "plugins/*/hooks/hooks.json"
---

<!-- Inert metadata (Claude Code reads only `paths`; block comments are stripped from context):
doc_type: claude_code_knowledge · topic: hook_handler.mcp_tool.event_compatibility · schema_version: 1
parse_priority: machine_first · confidence_levels: documented | inferred | community | unverified · status_values: full | limited
sources: official hooks reference https://code.claude.com/docs/en/hooks · release notes https://code.claude.com/docs/en/release-notes
· issues anthropics/claude-code#24788, #34713 · community (introduced-version claim) https://github.com/luongnv89/claude-howto/blob/main/06-hooks/README.md -->

# Claude Code Hook Handler `type:"mcp_tool"` — Event Compatibility Matrix

Last verified: 2026-10-03 — event set, `status`, block mechanism, `additional_context` and timeout of every row
reconciled against cc-reference (`claude-code-hooks-reference.md`, `claude-code-mcp-tool-hooks-reference.md`,
both verified 2026-10-02). `GLOBAL_MECHANICS.input_omitted_default` is a live observation on 2.1.226, not re-checked since.

PURPOSE: Decide, per hook event, whether the `mcp_tool` handler is fully usable
(`full`) or constrained (`limited`), and why. Optimized for harness/agent parsing.
The canonical machine-readable record is the `events` array in the JSON block under
`## CANONICAL_SPEC`. All prose is derived from that block; on conflict, the JSON wins.
Derive the full/limited event lists by filtering `events` on `status` (no separate lists are kept).

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
  "input_omitted_default": "EMPTY OBJECT {} -- NOT the full hook JSON. Live-verified on 2.1.226 (universal-format 0.14.1 incident: patched a live plugin-cache server.mjs to log raw params.arguments, confirmed {} for a real Write call). cc-reference's mcp_tool hook-fields table states the opposite (omitted input => the tool receives the full hook event JSON); live behavior on 2.1.226 differs, so ALWAYS set \"input\" explicitly and treat omission as 'this tool gets nothing'.",
  "input_omitted_default_confidence": "observed live on 2.1.226 (instrumented server, 2026-08-09); contradicts the full-event-JSON passthrough stated by cc-reference; not re-verified on later versions",
  "input_substitution": "string values support ${path} from hook JSON input, e.g. ${tool_input.file_path}, ${hook_event_name}, ${prompt}",
  "input_substitution_type_preservation": "NOT documented/verified. Assume every substituted value is a STRING even when the source field is a boolean/number/object (e.g. ${tool_input.replace_all} likely renders as the literal string \"true\"/\"false\", not a JS boolean) -- a consuming handler must tolerate the string-coerced form for any non-string field it needs. See plugins/universal-format/CLAUDE.md's \"Explicit hook input\" note for a worked fix.",
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
  "timeout_override_premodelswitch_s": 30,
  "timeout_override_postmodelswitch_s": 30,
  "timeout_override_messagedisplay_s": 10,
  "timeout_override_sessionend_s": 1.5,
  "timeout_override_sessionend_note": "1.5s default for the whole session-exit budget (/clear and /resume switches too); timeouts on plugin-provided hooks do NOT raise it",
  "timeout_behavior": "hook canceled, output discarded, never blocks (PreToolUse proceeds through the normal permission flow) -- EXCEPT PreModelSwitch: a timeout BLOCKS the model switch (version >= 2.1.251)",
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
- Events whose ONLY block path is exit code 2 (`TaskCompleted`, `TeammateIdle`, `WorktreeCreate`) => `mcp_tool` cannot block => `limited`.
- `{"continue": false}` is NOT a substitute block: it stops the whole turn/agent/teammate (the opposite of keep-working on `TeammateIdle`), and is ignored on `TaskCreated` and on a `TaskCompleted` fired by `TaskUpdate`.

## CANONICAL_SPEC

<!-- One column-aligned line per event is deliberate: this block is the machine-readable
     record and is read row-wise; prettier's expansion makes it unscannable. -->
<!-- prettier-ignore -->
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
    {"event": "SessionEnd",          "category": "side_effect", "supported": true, "status": "full",    "block_capable": false,    "block_mechanism": "none", "additional_context": false, "rewrite": null, "timeout_s": 1.5, "trigger": "auto", "limitation": null, "confidence": "documented", "note": "default timeout is 1.5s, not 600s, and plugin-provided hook timeouts do not raise it -- keep the MCP call fast"},
    {"event": "WorktreeRemove",      "category": "side_effect", "supported": true, "status": "full",    "block_capable": false,    "block_mechanism": "none (exit-code-only contract: non-zero fails removal, which mcp_tool cannot do; the hook itself must delete the dir)", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": null, "confidence": "documented"},
    {"event": "InstructionsLoaded",  "category": "side_effect", "supported": true, "status": "full",    "block_capable": false,    "block_mechanism": "none (async observability)", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "auto", "limitation": null, "confidence": "documented"},
    {"event": "DirectoryAdded",      "category": "side_effect", "supported": true, "status": "full",    "block_capable": false,    "block_mechanism": "none (the add already completed; systemMessage still surfaces: slash_command -> Claude context next turn, register_repo_root -> debug log only)", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": null, "confidence": "documented", "note": "runs async, the session does not wait; fires for /add-dir and SDK register_repo_root only (not the --add-dir startup flag)"},
    {"event": "TaskCreated",         "category": "task",        "supported": true, "status": "full",    "block_capable": true,     "block_mechanism": "json:decision=block (cancels + rolls back/deletes the task, reason returned to Claude as the tool error); continue:false is IGNORED for this event", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "semi", "limitation": null, "confidence": "documented", "note": "does not fire in a session without the Task tools"},
    {"event": "PostModelSwitch",     "category": "model",       "supported": true, "status": "full",    "block_capable": false,    "block_mechanism": "context_only (additionalContext or plain text, delivered with the next request; if not finished within 5s of that request it attaches to the following one)", "additional_context": true, "rewrite": null, "timeout_s": 30, "trigger": "manual", "limitation": null, "confidence": "documented", "note": "version >= 2.1.251; 30s timeout is the only constraint; also fires after Claude-Code-initiated changes (auto fallback, resume-restore, opusplan plan-mode switches); several switches before the next request deliver only the last one's output"},

    {"event": "SessionStart",        "category": "lifecycle",   "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "context_only", "additional_context": true, "rewrite": null, "timeout_s": 600, "trigger": "auto", "limitation": "mcp_tool hooks are SKIPPED outright at launch (incl. --continue/--resume; no MCP client yet) and run only on later fires (/clear, compaction) => use a command hook for anything needed at launch; no CLAUDE_ENV_FILE access", "confidence": "documented"},
    {"event": "Setup",               "category": "lifecycle",   "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "none (all JSON output incl. additionalContext is discarded on Setup)", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": "mcp_tool hooks on Setup are ALWAYS skipped: it fires before servers are available (--init/--maintenance) and only command hooks run => use a command hook; no CLAUDE_ENV_FILE access for mcp_tool", "confidence": "documented"},
    {"event": "UserPromptSubmit",    "category": "turn",        "supported": true, "status": "limited", "block_capable": true,     "block_mechanism": "json:decision=block + additionalContext", "additional_context": true, "rewrite": "none (context only)", "timeout_s": 30, "trigger": "auto", "limitation": "functionally full, but timeout reduced to 30s and the hook blocks model processing; an MCP round-trip on every prompt is a latency/cost choice", "confidence": "documented"},
    {"event": "MessageDisplay",      "category": "display",     "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "json:hookSpecificOutput.displayContent (display-only)", "additional_context": false, "rewrite": "displayContent", "timeout_s": 10, "trigger": "manual", "limitation": "10s timeout, runs per streamed line-batch, display-only => MCP round-trip per batch is impractical", "confidence": "documented"},
    {"event": "PreModelSwitch",      "category": "model",       "supported": true, "status": "limited", "block_capable": true,     "block_mechanism": "json:hookSpecificOutput.permissionDecision(allow|deny|ask) or top-level decision=block (ask is honored only by interactive /model, a refusal on every other surface)", "additional_context": false, "rewrite": null, "timeout_s": 30, "trigger": "manual", "limitation": "functionally full, but the timeout is reduced to 30s and a timeout BLOCKS the model switch (the one event where timeout acts like exit 2): a slow or stalled MCP call can deny a legitimate /model switch, while a not-connected server is only a non-blocking error; version >= 2.1.251", "confidence": "documented"},
    {"event": "CwdChanged",          "category": "side_effect", "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "none (cannot block the cd; only the documented JSON watchPaths return)", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "semi", "limitation": "primary documented purpose is reactive env management via CLAUDE_ENV_FILE, which mcp_tool cannot use; otherwise a side-effect trigger (plus the JSON watchPaths return)", "confidence": "documented"},
    {"event": "FileChanged",         "category": "side_effect", "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "none (cannot block the change; only the documented JSON watchPaths return)", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": "same CLAUDE_ENV_FILE gap as CwdChanged; a reaction trigger (plus the JSON watchPaths return)", "confidence": "documented"},
    {"event": "StopFailure",         "category": "turn",        "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "none", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": "output and exit code are ignored (true for all handler types); mcp_tool can only fire as a side-effect, returns nothing usable", "confidence": "documented"},
    {"event": "TaskCompleted",       "category": "task",        "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "exit2 (prevent completion) UNAVAILABLE; json:continue=false stops the teammate entirely and is IGNORED when TaskUpdate triggered the event", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "semi", "limitation": "preventing completion needs exit code 2, which mcp_tool cannot emit; continue:false is no substitute (it stops the teammate, and is ignored when TaskUpdate marked the task done)", "confidence": "documented"},
    {"event": "TeammateIdle",        "category": "task",        "supported": true, "status": "limited", "block_capable": false,    "block_mechanism": "exit2 (keep working) UNAVAILABLE; json:continue=false stops the teammate entirely (the opposite of keep-working)", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": "keep-working needs exit code 2, which mcp_tool cannot emit; its only decision field, continue:false, stops the teammate instead; requires agent teams", "confidence": "documented"},
    {"event": "WorktreeCreate",      "category": "lifecycle",   "supported": true, "status": "limited", "block_capable": "uncertain", "block_mechanism": "command:stdout path / http:worktreePath; any non-zero exit aborts creation", "additional_context": false, "rewrite": null, "timeout_s": 600, "trigger": "manual", "limitation": "drives creation via returned path + exit-code failure; mcp_tool failure is non-blocking so it cannot abort creation, and reliable path return via the text-as-stdout channel is unconfirmed", "confidence": "unverified"}
  ]
}
```

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
      "claim": "mcp_tool block capability on the task/worktree events: TaskCreated blocks via decision:block; TaskCompleted/TeammateIdle only via exit 2; WorktreeCreate via any non-zero exit",
      "status": "partly_documented",
      "detail": "Task rows re-derived from cc-reference's decision-control table: TaskCreated takes exit 2 or decision:block (continue:false ignored); TaskCompleted/TeammateIdle take exit 2 or continue:false, which stops the teammate rather than keeping it working and is ignored for a TaskUpdate-triggered TaskCompleted. mcp_tool has no exit-2 path, so those two stay limited; no live mcp_tool run on any of these events exists. WorktreeCreate stays unverified: cc-reference documents only the command (stdout path) and http (hookSpecificOutput.worktreePath) return channels, and mcp_tool's text-as-stdout path return is untested."
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

- Treat `confidence: inferred|unverified` rows as hypotheses; verify live (no dedicated
  harness exists in this repo): point a throwaway `mcp_tool` hook at a minimal stdio MCP
  server whose tool returns the candidate JSON (`{"continue":false}`,
  `{"decision":"block","reason":"x"}`, a `hookSpecificOutput` object), then read the
  outcome in the debug log (`claude --debug-file <path>`, or `/debug` mid-session;
  `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose` for matcher detail) and the `/hooks` browser.
- For any hard allow/deny enforcement, do NOT use `mcp_tool`; use the permission
  system or a `command` hook with exit code 2.
- For `SessionStart`/`Setup`, do NOT rely on `mcp_tool` for anything needed at launch:
  Claude Code skips `mcp_tool` hooks there outright (always on `Setup`; on `SessionStart`
  at launch incl. `--continue`/`--resume`, they only run on later fires such as `/clear`
  or compaction). Use a `command` hook.
