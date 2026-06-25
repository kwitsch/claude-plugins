/**
 * adapters/kiro — Kiro IDE/CLI platform adapter.
 *
 * Implements HookAdapter for Kiro's hooks-capable paradigm (json-stdio).
 *
 * Kiro specifics:
 *   - Hooks via agent config files (~/.kiro/agents/<name>.json)
 *   - Config: ~/.kiro/settings/mcp.json (JSON format)
 *   - MCP: full support via mcpServers in mcp.json
 *   - Hook exit codes: 0=allow, 2=block
 *   - Cannot modify tool input (exit codes only)
 *   - Session dir: ~/.kiro/context-mode/sessions/
 *   - Routing file: KIRO.md
 *
 * Sources:
 *   - MCP config: https://kiro.dev/docs/mcp/configuration/
 *   - clientInfo.name: https://github.com/kirodotdev/Kiro/issues/5205 ("Kiro CLI")
 *   - CLI hooks: https://kiro.dev/docs/cli/custom-agents/configuration-reference#hooks-field
 */
import { BaseAdapter } from "../base.js";
/**
 * Steering integration: we ship a single context-mode-specific routing file
 * at `configs/kiro/KIRO.md`. Users can copy it into `.kiro/steering/` to opt
 * into deterministic injection. We do NOT deploy generic SDD scaffolds (e.g.
 * cc-sdd's product/structure/tech + steering-custom/* templates) — those are
 * project-template content, not adapter wiring.
 */
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, PreToolUseEvent, PostToolUseEvent, PreCompactEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, PreCompactResponse, SessionStartResponse, HookRegistration } from "../types.js";
export declare class KiroAdapter extends BaseAdapter implements HookAdapter {
    constructor();
    readonly name = "Kiro";
    readonly paradigm: HookParadigm;
    readonly capabilities: PlatformCapabilities;
    parsePreToolUseInput(raw: unknown): PreToolUseEvent;
    parsePostToolUseInput(raw: unknown): PostToolUseEvent;
    parsePreCompactInput(_raw: unknown): PreCompactEvent;
    parseSessionStartInput(raw: unknown): SessionStartEvent;
    formatPreToolUseResponse(response: PreToolUseResponse): unknown;
    formatPostToolUseResponse(_response: PostToolUseResponse): unknown;
    formatPreCompactResponse(_response: PreCompactResponse): unknown;
    formatSessionStartResponse(response: SessionStartResponse): unknown;
    getSettingsPath(): string;
    /**
     * Kiro stores per-project context under .kiro/ (steering files, etc).
     * Auto-memory + rule detection use this project-relative dir, returned as
     * an absolute path resolved against `projectDir` (or `process.cwd()`).
     * (Settings/MCP config still live under ~/.kiro/.)
     */
    getConfigDir(projectDir?: string): string;
    getInstructionFiles(): string[];
    generateHookConfig(pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(settings: Record<string, unknown>): void;
    validateHooks(pluginRoot: string): DiagnosticResult[];
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    configureAllHooks(pluginRoot: string): string[];
    setHookPermissions(_pluginRoot: string): string[];
    updatePluginRegistry(_pluginRoot: string, _version: string): void;
    getRoutingInstructions(): string;
}
