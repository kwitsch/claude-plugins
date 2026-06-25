/**
 * adapters/zed — Zed editor platform adapter.
 *
 * Implements HookAdapter for Zed's MCP-only paradigm.
 *
 * Zed hook specifics:
 *   - NO hook support — Zed is an editor, not a CLI with hook pipelines
 *   - Config: ~/.config/zed/settings.json (JSON format)
 *   - MCP: full support via context_servers section in settings.json
 *   - All capabilities are false — MCP is the only integration path
 *   - Session dir: ~/.config/zed/context-mode/sessions/
 */
import { BaseAdapter } from "../base.js";
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, PreToolUseEvent, PostToolUseEvent, PreCompactEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, PreCompactResponse, SessionStartResponse, HookRegistration } from "../types.js";
export declare class ZedAdapter extends BaseAdapter implements HookAdapter {
    constructor();
    readonly name = "Zed";
    readonly paradigm: HookParadigm;
    readonly capabilities: PlatformCapabilities;
    parsePreToolUseInput(_raw: unknown): PreToolUseEvent;
    parsePostToolUseInput(_raw: unknown): PostToolUseEvent;
    parsePreCompactInput(_raw: unknown): PreCompactEvent;
    parseSessionStartInput(_raw: unknown): SessionStartEvent;
    formatPreToolUseResponse(_response: PreToolUseResponse): unknown;
    formatPostToolUseResponse(_response: PostToolUseResponse): unknown;
    formatPreCompactResponse(_response: PreCompactResponse): unknown;
    formatSessionStartResponse(_response: SessionStartResponse): unknown;
    getSettingsPath(): string;
    getInstructionFiles(): string[];
    generateHookConfig(_pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(settings: Record<string, unknown>): void;
    validateHooks(_pluginRoot: string): DiagnosticResult[];
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    configureAllHooks(_pluginRoot: string): string[];
    setHookPermissions(_pluginRoot: string): string[];
    updatePluginRegistry(_pluginRoot: string, _version: string): void;
    getRoutingInstructions(): string;
}
