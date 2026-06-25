/**
 * adapters/claude-code/hooks — Claude Code hook definitions and matchers.
 *
 * Defines the hook types, matchers, and registration format specific to
 * Claude Code's hook system. This module is used by:
 *   - CLI setup/upgrade commands (to configure hooks in settings.json)
 *   - Doctor command (to validate hook configuration)
 *   - hooks.json generation
 *
 * Claude Code hook system reference:
 *   - Hooks are registered in ~/.claude/settings.json under "hooks" key
 *   - Each hook type maps to an array of { matcher, hooks } entries
 *   - matcher: tool name pattern (empty = match all tools)
 *   - hooks: array of { type: "command", command: "..." }
 *   - Input: JSON on stdin
 *   - Output: JSON on stdout (or empty for passthrough)
 */
/** Claude Code hook types. */
export declare const HOOK_TYPES: {
    readonly PRE_TOOL_USE: "PreToolUse";
    readonly POST_TOOL_USE: "PostToolUse";
    readonly PRE_COMPACT: "PreCompact";
    readonly SESSION_START: "SessionStart";
    readonly USER_PROMPT_SUBMIT: "UserPromptSubmit";
};
export type HookType = (typeof HOOK_TYPES)[keyof typeof HOOK_TYPES];
/**
 * External MCP catch-all matcher for Claude Code (#529, #547 hotfix).
 *
 * Claude Code's hook matcher engine treats this entry as a substring match
 * (it also accepts regex, but `mcp__` alone is enough — every MCP tool
 * surfaces as `mcp__<server>__<tool>`). v1.0.124 used a negative lookahead
 * `mcp__(?!plugin_context-mode_)` to skip context-mode's own MCP tools,
 * but this same hooks.json is bundled to Codex CLI which uses Rust's
 * `regex` crate (no look-around support) — Codex rejected the matcher at
 * boot, breaking every Codex user (#547). Drop the lookaround on both
 * sides; the hook BODY (`isExternalMcpTool()` in hooks/core/routing.mjs)
 * already filters context-mode's own tools, so semantics are preserved.
 */
export declare const EXTERNAL_MCP_MATCHER_PATTERN = "mcp__";
/** Tools that context-mode's PreToolUse hook intercepts. */
export declare const PRE_TOOL_USE_MATCHERS: readonly ["Bash", "WebFetch", "Read", "Grep", "Agent", "mcp__plugin_context-mode_context-mode__ctx_execute", "mcp__plugin_context-mode_context-mode__ctx_execute_file", "mcp__plugin_context-mode_context-mode__ctx_batch_execute", "mcp__"];
/**
 * Combined matcher pattern for settings.json (pipe-separated).
 * Used by the upgrade command when writing a single consolidated entry.
 */
export declare const PRE_TOOL_USE_MATCHER_PATTERN: string;
/**
 * Tools that context-mode's PostToolUse hook should fire on.
 * Only tools that extractEvents() actually handles — all others
 * produce zero events and cause false "hook error" display.
 */
export declare const POST_TOOL_USE_MATCHERS: readonly ["Bash", "Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep", "TodoWrite", "TaskCreate", "TaskUpdate", "EnterPlanMode", "ExitPlanMode", "Skill", "Agent", "AskUserQuestion", "EnterWorktree", "mcp__"];
/**
 * Combined matcher pattern for PostToolUse in hooks.json / settings.json.
 */
export declare const POST_TOOL_USE_MATCHER_PATTERN: string;
/** Map of hook types to their script file names. */
export declare const HOOK_SCRIPTS: Record<HookType, string>;
/** Required hooks that must be configured for context-mode to function. */
export declare const REQUIRED_HOOKS: HookType[];
/** Optional hooks that enhance functionality but aren't critical. */
export declare const OPTIONAL_HOOKS: HookType[];
/**
 * Check if a hook entry points to a context-mode hook script.
 * Matches both legacy format (node .../pretooluse.mjs) and
 * CLI dispatcher format (context-mode hook claude-code pretooluse).
 */
export declare function isContextModeHook(entry: {
    hooks?: Array<{
        command?: string;
    }>;
}, hookType: HookType): boolean;
/**
 * Build the hook command string for a given hook type.
 * Uses process.execPath + forward slashes to avoid PATH issues and MSYS
 * path mangling on Windows (#369, #372).
 * Falls back to CLI dispatcher if pluginRoot is not provided.
 */
export declare function buildHookCommand(hookType: HookType, pluginRoot?: string): string;
/**
 * Extract the hook script file path from a command string.
 *
 * Algo-D2 twin — same shape as `src/util/hook-config.ts::extractHookScriptPath`.
 * Delegates to `parseNodeCommand` for canonical buildNodeCommand-shape;
 * keeps narrow legacy fallbacks for pre-D3 settings.json entries
 * (`node "X.mjs"` and `node X.mjs` with no internal whitespace).
 *
 * Pre-D2 this matched `node\s+"?([^"]+\.mjs)"?` — the unquoted fallback
 * silently grabbed the tail after the last whitespace, producing the
 * #548 doubled-path FAIL on Windows paths with spaces. The new shape
 * refuses ambiguous input; doctor (Algo-D1) falls through to direct
 * `existsSync` instead of trusting the regex.
 */
export declare function extractHookScriptPath(command: string): string | null;
/**
 * Check if a hook entry is a context-mode hook (any hook type).
 * Broader than `isContextModeHook` — matches any context-mode script name
 * without requiring a specific hookType.
 */
export declare function isAnyContextModeHook(entry: {
    hooks?: Array<{
        command?: string;
    }>;
}): boolean;
