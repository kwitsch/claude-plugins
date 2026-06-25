/**
 * adapters/cursor — Cursor platform adapter.
 *
 * Native Cursor hooks use lower-camel hook names and flat command entries in
 * `.cursor/hooks.json` / `~/.cursor/hooks.json`.
 */
import { BaseAdapter } from "../base.js";
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, PreToolUseEvent, PostToolUseEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, SessionStartResponse, HookRegistration } from "../types.js";
interface StopEvent {
    sessionId: string;
    status: string;
    loopCount: number;
    generationId?: string;
    transcriptPath?: string;
}
export declare class CursorAdapter extends BaseAdapter implements HookAdapter {
    constructor();
    readonly name = "Cursor";
    readonly paradigm: HookParadigm;
    readonly capabilities: PlatformCapabilities;
    parsePreToolUseInput(raw: unknown): PreToolUseEvent;
    parsePostToolUseInput(raw: unknown): PostToolUseEvent;
    parseSessionStartInput(raw: unknown): SessionStartEvent;
    formatPreToolUseResponse(response: PreToolUseResponse): unknown;
    formatPostToolUseResponse(response: PostToolUseResponse): unknown;
    formatSessionStartResponse(response: SessionStartResponse): unknown;
    parseStopInput(raw: unknown): StopEvent;
    formatStopResponse(response: {
        followupMessage?: string;
    }): Record<string, unknown>;
    parseAfterAgentResponseInput(raw: unknown): {
        text: string;
    };
    getSettingsPath(): string;
    /**
     * Cursor stores conventions per project under .cursor/. Always returned
     * as an absolute path resolved against `projectDir` (or `process.cwd()`
     * when omitted) per the HookAdapter.getConfigDir contract.
     */
    getConfigDir(projectDir?: string): string;
    getInstructionFiles(): string[];
    generateHookConfig(_pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(settings: Record<string, unknown>): void;
    validateHooks(_pluginRoot: string): DiagnosticResult[];
    /**
     * Detects context-mode plugin installations under Cursor's plugin directories.
     * Returns absolute paths to any `.cursor-plugin/plugin.json` files whose
     * `name` matches `context-mode`.
     */
    private detectPluginInstalls;
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    configureAllHooks(_pluginRoot: string): string[];
    setHookPermissions(pluginRoot: string): string[];
    updatePluginRegistry(_pluginRoot: string, _version: string): void;
    private getCandidateHookConfigPaths;
    private getProjectDir;
    private extractSessionId;
    private loadNativeHookConfig;
    private hasClaudeCompatibilityHooks;
    private upsertHookEntry;
}
export {};
