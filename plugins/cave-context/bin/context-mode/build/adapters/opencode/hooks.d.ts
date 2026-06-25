/**
 * adapters/opencode/hooks — OpenCode hook definitions and validators.
 *
 * Defines the hook types and validation helpers specific to OpenCode's
 * TypeScript plugin paradigm. This module is used by:
 *   - CLI setup/upgrade commands (to configure plugin in opencode.json)
 *   - Doctor command (to validate plugin configuration)
 *
 * OpenCode hook system reference:
 *   - I/O: TS plugin functions (not JSON stdin/stdout)
 *   - Hook names: tool.execute.before, tool.execute.after, experimental.session.compacting
 *   - Arg modification: output.args mutation
 *   - Blocking: throw Error in tool.execute.before
 *   - SessionStart: broken (#14808, no hook #5409)
 *   - Config: opencode.json plugin array, .opencode/plugins/*.ts
 */
/** OpenCode hook types (TS plugin event names). */
export declare const HOOK_TYPES: {
    readonly BEFORE: "tool.execute.before";
    readonly AFTER: "tool.execute.after";
    readonly COMPACTING: "experimental.session.compacting";
};
export type HookType = (typeof HOOK_TYPES)[keyof typeof HOOK_TYPES];
/**
 * Required hooks that must be active for context-mode to function.
 * OpenCode uses TS plugin paradigm — no scripts, just event hooks.
 */
export declare const REQUIRED_HOOKS: HookType[];
/**
 * Optional hooks that enhance functionality but aren't critical.
 * experimental.session.compacting is advisory.
 */
export declare const OPTIONAL_HOOKS: HookType[];
/**
 * Check if an OpenCode plugin entry is the context-mode plugin.
 * OpenCode plugins are registered as strings in the plugin array.
 */
export declare function isContextModePlugin(pluginEntry: string): boolean;
