/**
 * adapters/cursor/hooks — Cursor hook definitions and config helpers.
 *
 * Cursor native hook config lives in `.cursor/hooks.json` or `~/.cursor/hooks.json`.
 * Unlike Claude/Gemini/VS Code Copilot, each hook entry is a flat object rather
 * than a `{ matcher, hooks: [...] }` wrapper.
 */
/** Cursor hook type names. */
export declare const HOOK_TYPES: {
    readonly PRE_TOOL_USE: "preToolUse";
    readonly POST_TOOL_USE: "postToolUse";
    readonly SESSION_START: "sessionStart";
    readonly STOP: "stop";
    readonly AFTER_AGENT_RESPONSE: "afterAgentResponse";
};
export type HookType = (typeof HOOK_TYPES)[keyof typeof HOOK_TYPES];
/** Map of hook types that have actual script files. */
export declare const HOOK_SCRIPTS: Partial<Record<HookType, string>>;
/**
 * Negative-lookahead matcher for external MCP tool namespaces on Cursor (#529).
 *
 * Cursor MCP wire shape: `MCP:<tool>` (verified in
 * tests/fixtures/cursor/pretooluse-mcp.json, hooks/cursor/posttooluse.mjs:19-25).
 * Context-mode's own tools surface as `MCP:ctx_<...>`. The negative lookahead
 * on the `ctx_` prefix fires for every other MCP tool whose payload would
 * otherwise flood the model's context window before PostToolUse can act.
 *
 * Routing.mjs `isExternalMcpTool` is extended to recognise the `MCP:` prefix
 * so the routing branch returns external-MCP guidance instead of passthrough.
 */
export declare const EXTERNAL_MCP_MATCHER_PATTERN = "MCP:(?!ctx_)";
/** Canonical Cursor-native matchers for tools context-mode routes proactively. */
export declare const PRE_TOOL_USE_MATCHERS: readonly ["Shell", "Read", "Grep", "WebFetch", "mcp_web_fetch", "mcp_fetch_tool", "Task", "MCP:ctx_execute", "MCP:ctx_execute_file", "MCP:ctx_batch_execute", "MCP:(?!ctx_)"];
export declare const PRE_TOOL_USE_MATCHER_PATTERN: string;
/** Required hooks for native Cursor support. */
export declare const REQUIRED_HOOKS: HookType[];
/** Optional hooks that improve behavior but aren't strictly required. */
export declare const OPTIONAL_HOOKS: HookType[];
/** Minimal native Cursor hook entry shape. */
export interface CursorHookCommandEntry {
    type?: string;
    command?: string;
    matcher?: string;
    timeout?: number;
    loop_limit?: number | null;
    failClosed?: boolean;
}
/** Check whether a native Cursor hook entry points to context-mode. */
export declare function isContextModeHook(entry: CursorHookCommandEntry | {
    hooks?: Array<{
        command?: string;
    }>;
}, hookType: HookType): boolean;
/** Build the CLI dispatcher command for a Cursor hook type. */
export declare function buildHookCommand(hookType: HookType): string;
