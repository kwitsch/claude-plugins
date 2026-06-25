/**
 * adapters/opencode — OpenCode platform adapter.
 *
 * Implements HookAdapter for OpenCode's TypeScript plugin paradigm.
 *
 * OpenCode hook specifics:
 *   - I/O: TS plugin functions (not JSON stdin/stdout)
 *   - Hook names: tool.execute.before, tool.execute.after, experimental.session.compacting
 *   - Arg modification: output.args mutation
 *   - Blocking: throw Error in tool.execute.before
 *   - Output modification: output.output mutation (TUI bug for bash #13575)
 *   - SessionStart: broken (#14808, no hook #5409)
 *   - Session ID: input.sessionID (camelCase!)
 *   - Project dir: ctx.directory in plugin init (no env var)
 *   - Config: opencode.json plugin array, .opencode/plugins/*.ts
 *   - Session dir: ~/.config/opencode/context-mode/sessions/
 */
import { BaseAdapter } from "../base.js";
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, PreToolUseEvent, PostToolUseEvent, PreCompactEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, PreCompactResponse, SessionStartResponse, HookRegistration, PlatformId } from "../types.js";
export type AdapterPlatformType = Extract<PlatformId, "opencode" | "kilo">;
export declare class OpenCodeAdapter extends BaseAdapter implements HookAdapter {
    get name(): string;
    readonly paradigm: HookParadigm;
    private settingsPath?;
    readonly capabilities: PlatformCapabilities;
    private platform;
    constructor(platform?: AdapterPlatformType);
    parsePreToolUseInput(raw: unknown): PreToolUseEvent;
    parsePostToolUseInput(raw: unknown): PostToolUseEvent;
    parsePreCompactInput(raw: unknown): PreCompactEvent;
    parseSessionStartInput(raw: unknown): SessionStartEvent;
    formatPreToolUseResponse(response: PreToolUseResponse): unknown;
    formatPostToolUseResponse(response: PostToolUseResponse): unknown;
    formatPreCompactResponse(response: PreCompactResponse): unknown;
    formatSessionStartResponse(response: SessionStartResponse): unknown;
    getSettingsPath(): string;
    private paths;
    getSessionDir(): string;
    /**
     * OpenCode/KiloCode honor XDG_CONFIG_HOME on POSIX and APPDATA on Windows.
     * Falls back to ~/.config/<platform> (or %APPDATA%\<platform>).
     * Always absolute. `_projectDir` is accepted for interface symmetry but
     * unused — config is home/XDG-rooted, never project-scoped.
     */
    getConfigDir(_projectDir?: string): string;
    getInstructionFiles(): string[];
    generateHookConfig(_pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(settings: Record<string, unknown>): void;
    validateHooks(_pluginRoot: string): DiagnosticResult[];
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    configureAllHooks(_pluginRoot: string): string[];
    backupSettings(): string | null;
    setHookPermissions(_pluginRoot: string): string[];
    updatePluginRegistry(_pluginRoot: string, _version: string): void;
    /**
     * Check whether a settings object has the context-mode plugin registered.
     */
    private hasContextModePlugin;
    private hasLegacyContextModeMcp;
    /**
     * Extract session ID from OpenCode hook input.
     * OpenCode uses camelCase sessionID.
     */
    private extractSessionId;
}
