/**
 * adapters/antigravity — Google Antigravity platform adapter.
 *
 * Implements HookAdapter for Antigravity's MCP-only paradigm.
 *
 * Antigravity hook specifics:
 *   - NO hook support (MCP-only, same as Codex CLI)
 *   - Config: ~/.gemini/antigravity/mcp_config.json (JSON format)
 *   - MCP: full support via mcpServers in mcp_config.json
 *   - All capabilities are false — MCP is the only integration path
 *   - Session dir: ~/.gemini/context-mode/sessions/
 *   - Routing file: GEMINI.md (shared with Gemini CLI filename, different content)
 *
 * Sources:
 *   - Config path: https://github.com/google-gemini/gemini-cli/issues/16058
 *   - MCP support: https://antigravity.google/docs/mcp
 *   - Tool list: System prompt leak (21 verified tools)
 */
import { BaseAdapter } from "../base.js";
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, PreToolUseEvent, PostToolUseEvent, PreCompactEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, PreCompactResponse, SessionStartResponse, HookRegistration } from "../types.js";
export declare class AntigravityAdapter extends BaseAdapter implements HookAdapter {
    constructor();
    readonly name = "Antigravity";
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
    /**
     * Antigravity nests under ~/.gemini/antigravity/. Always absolute.
     * `_projectDir` accepted for interface symmetry but unused — home-rooted.
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
    setHookPermissions(_pluginRoot: string): string[];
    updatePluginRegistry(_pluginRoot: string, _version: string): void;
    getRoutingInstructions(): string;
}
