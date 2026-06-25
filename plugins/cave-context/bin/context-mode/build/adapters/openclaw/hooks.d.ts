/**
 * adapters/openclaw/hooks — OpenClaw hook definitions and validators.
 *
 * Defines the hook types and validation helpers specific to OpenClaw's
 * TypeScript plugin paradigm. This module is used by:
 *   - CLI setup/upgrade commands (to configure plugin in openclaw.json)
 *   - Doctor command (to validate plugin configuration)
 *
 * OpenClaw hook system reference:
 *   - I/O: TS plugin functions via api.registerHook() and api.on()
 *   - Hook events: tool_call:before, tool_call:after, command:new, command:reset
 *   - Lifecycle: session_start, before_compaction, after_compaction, before_prompt_build, before_model_resolve
 *   - Context engine: api.registerContextEngine() with ownsCompaction
 *   - Blocking: return { block: true, blockReason } from tool_call:before
 *   - Config: openclaw.json plugins.entries, ~/.openclaw/extensions/
 */
/** OpenClaw hook event names (registered via api.registerHook). */
export declare const HOOK_EVENTS: {
    readonly TOOL_CALL_BEFORE: "tool_call:before";
    readonly TOOL_CALL_AFTER: "tool_call:after";
    readonly COMMAND_NEW: "command:new";
    readonly COMMAND_RESET: "command:reset";
    readonly COMMAND_STOP: "command:stop";
};
/** OpenClaw lifecycle hook names (registered via api.on). */
export declare const LIFECYCLE_HOOKS: {
    readonly SESSION_START: "session_start";
    readonly BEFORE_COMPACTION: "before_compaction";
    readonly AFTER_COMPACTION: "after_compaction";
    readonly BEFORE_PROMPT_BUILD: "before_prompt_build";
    readonly BEFORE_MODEL_RESOLVE: "before_model_resolve";
    readonly BEFORE_AGENT_START: "before_agent_start";
};
export type HookEvent = (typeof HOOK_EVENTS)[keyof typeof HOOK_EVENTS];
export type LifecycleHook = (typeof LIFECYCLE_HOOKS)[keyof typeof LIFECYCLE_HOOKS];
/**
 * Required hooks that must be active for context-mode to function.
 * OpenClaw registers these via api.registerHook() in the plugin entry point.
 */
export declare const REQUIRED_HOOKS: HookEvent[];
/**
 * Optional hooks that enhance functionality but aren't critical.
 * command:new provides session cleanup; context engine handles compaction.
 */
export declare const OPTIONAL_HOOKS: HookEvent[];
/**
 * Check if a plugin entry is the context-mode plugin.
 * OpenClaw plugins are registered by id in plugins.entries.
 */
export declare function isContextModePlugin(pluginId: string): boolean;
