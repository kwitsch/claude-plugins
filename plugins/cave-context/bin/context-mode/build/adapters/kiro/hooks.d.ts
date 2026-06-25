/**
 * adapters/kiro/hooks — Kiro CLI hook definitions and matchers.
 *
 * Kiro CLI hook system reference:
 *   - Hooks are in agent config files (~/.kiro/agents/<name>.json) under "hooks" key
 *   - Each hook type maps to an array of { matcher, command } entries
 *   - Hook names: preToolUse, postToolUse, agentSpawn, userPromptSubmit
 *   - Input: JSON on stdin
 *   - Output: exit codes (0=allow, 2=block) + stdout/stderr
 *
 * Source: https://kiro.dev/docs/cli/custom-agents/configuration-reference#hooks-field
 */
export declare const HOOK_TYPES: {
    readonly PRE_TOOL_USE: "preToolUse";
    readonly POST_TOOL_USE: "postToolUse";
    readonly AGENT_SPAWN: "agentSpawn";
    readonly USER_PROMPT_SUBMIT: "userPromptSubmit";
};
export type HookType = (typeof HOOK_TYPES)[keyof typeof HOOK_TYPES];
export declare const HOOK_SCRIPTS: Record<string, string>;
/**
 * Negative-lookahead matcher for external MCP tool namespaces on Kiro (#529).
 *
 * Kiro MCP wire shape: `@<server>/<tool>` (verified in
 * hooks/core/tool-naming.mjs — context-mode's own tools surface as
 * `@context-mode/<tool>`). This pattern fires PreToolUse for any external
 * `@<server>/<tool>` whose server segment is NOT `context-mode`. Without it,
 * large payloads from slack / telegram / gdrive / notion-style MCPs bypass
 * the routing nudge and flood the model's context window — PostToolUse runs
 * too late to keep the raw data out.
 *
 * Routing.mjs `isExternalMcpTool` is extended to recognise the `@<server>/`
 * prefix shape so the routing branch returns external-MCP guidance.
 */
export declare const EXTERNAL_MCP_MATCHER_PATTERN = "@(?!context-mode/)";
/**
 * Tools that context-mode's PreToolUse hook intercepts on Kiro.
 *
 * Kiro native tool names (from TOOL_ALIASES in routing.mjs):
 *   execute_bash → Bash, fs_read → Read, fs_write → Write
 *
 * MCP tools surface as @context-mode/ctx_* in Kiro.
 */
export declare const PRE_TOOL_USE_MATCHERS: readonly ["execute_bash", "fs_read", "@context-mode/ctx_execute", "@context-mode/ctx_execute_file", "@context-mode/ctx_batch_execute", "@(?!context-mode/)"];
/**
 * Combined matcher pattern for Kiro hook config (pipe-separated).
 * Used by generateHookConfig and configureAllHooks.
 */
export declare const PRE_TOOL_USE_MATCHER_PATTERN: string;
export declare const REQUIRED_HOOKS: string[];
export declare const OPTIONAL_HOOKS: string[];
/**
 * Check if a hook entry points to a context-mode hook script.
 */
export declare function isContextModeHook(entry: {
    command?: string;
}, hookType: string): boolean;
/**
 * Build the hook command string for a given hook type.
 */
export declare function buildHookCommand(hookType: string, pluginRoot?: string): string;
