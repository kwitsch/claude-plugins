// types/cc-types.d.ts — Claude Code hook payload types.
// Sourced from cc-reference hooks schema (claude-code-hooks-reference.md).
// RULE: extend this file whenever a new Claude Code API surface (hook event field,
// output shape, MCP tool schema) is introduced in a .mjs file.
// See .claude/rules/cc-types.md.

interface HookCommonInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: 'default' | 'plan' | 'acceptEdits' | 'auto' | 'dontAsk' | 'bypassPermissions';
  hook_event_name: string;
  agent_id?: string;
  agent_type?: string;
  /** Only on SessionStart; not guaranteed. */
  model?: string;
  /** SessionStart source: startup | resume | compact | clear */
  source?: string;
}

interface ToolHookInput extends HookCommonInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id?: string;
}

interface StopHookInput extends HookCommonInput {
  stop_hook_active: boolean;
  last_assistant_message: string;
  background_tasks: unknown[];
  session_crons: unknown[];
}

interface ToolResponse {
  success?: boolean;
  filePath?: string;
  [k: string]: unknown;
}

interface PostToolUseHookInput extends ToolHookInput {
  /** Present only on PostToolUse; the executed tool's result. */
  tool_response?: ToolResponse;
}

interface HookSpecificOutput {
  hookEventName: string;
  additionalContext?: string;
  permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer';
  permissionDecisionReason?: string;
  updatedInput?: Record<string, unknown>;
}

interface HookResult {
  decision?: 'block';
  reason?: string;
  hookSpecificOutput?: HookSpecificOutput;
  updatedInput?: Record<string, unknown>;
}

interface CompressResult {
  compressed: string;
  changed: boolean;
  valid: boolean;
  errors: string[];
  reason?: string;
}

interface GitInfo {
  root: string;
  branch: string;
}
