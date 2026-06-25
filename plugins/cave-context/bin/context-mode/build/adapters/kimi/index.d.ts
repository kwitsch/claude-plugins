/**
 * adapters/kimi — Kimi Code CLI platform adapter.
 *
 * Implements HookAdapter for Kimi Code CLI's JSON stdin/stdout paradigm.
 *
 * Kimi Code CLI hook specifics:
 *   - 7 hook events: PreToolUse, PostToolUse, PreCompact, SessionStart,
 *     SessionEnd, UserPromptSubmit, Stop
 *   - Same wire protocol as Codex CLI (JSON stdin → stdout)
 *   - Config: $KIMI_CODE_HOME or ~/.kimi-code (config.toml + mcp.json)
 *   - Hooks are inline `[[hooks]]` array tables in config.toml
 *   - Session dir: $KIMI_CODE_HOME/context-mode/sessions/
 *
 * PreToolUse is deny-only — ask / modify / additionalContext are silently
 * dropped by the host runner (verified upstream at runner.ts:36-39,162-178).
 */
import { BaseAdapter } from "../base.js";
import { type HookAdapter, type HookParadigm, type PlatformCapabilities, type DiagnosticResult, type PreToolUseEvent, type PostToolUseEvent, type PreCompactEvent, type SessionStartEvent, type PreToolUseResponse, type PostToolUseResponse, type PreCompactResponse, type SessionStartResponse, type HookRegistration } from "../types.js";
type KimiVersionRunner = (file: string, args: string[], options: {
    encoding: BufferEncoding;
    stdio: ["ignore", "pipe", "ignore"];
    timeout: number;
}) => string | Buffer;
export declare function probeKimiCliVersion(runCommand?: KimiVersionRunner): string | null;
export declare class KimiAdapter extends BaseAdapter implements HookAdapter {
    constructor();
    readonly name = "Kimi Code CLI";
    readonly paradigm: HookParadigm;
    readonly capabilities: PlatformCapabilities;
    parsePreToolUseInput(raw: unknown): PreToolUseEvent;
    parsePostToolUseInput(raw: unknown): PostToolUseEvent;
    parsePreCompactInput(raw: unknown): PreCompactEvent;
    parseSessionStartInput(raw: unknown): SessionStartEvent;
    formatPreToolUseResponse(response: PreToolUseResponse): unknown;
    formatPostToolUseResponse(response: PostToolUseResponse): unknown;
    formatPreCompactResponse(_response: PreCompactResponse): unknown;
    formatSessionStartResponse(response: SessionStartResponse): unknown;
    getConfigDir(_projectDir?: string): string;
    getSettingsPath(): string;
    getMcpPath(): string;
    getSessionDir(): string;
    getInstructionFiles(): string[];
    getMemoryDir(projectDir?: string): string;
    generateHookConfig(_pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(_settings: Record<string, unknown>): void;
    validateHooks(_pluginRoot: string): DiagnosticResult[];
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    configureAllHooks(_pluginRoot: string): string[];
    backupSettings(): string | null;
    setHookPermissions(_pluginRoot: string): string[];
    updatePluginRegistry(_pluginRoot: string, _version: string): void;
    getRoutingInstructions(): string;
    private getProjectDir;
    private extractSessionId;
    private backupFile;
    private isExpectedHookEntry;
    private entryContainsManagedCommand;
    /**
     * Rebuild config.toml by removing old managed hooks and appending new ones.
     * Preserves everything outside [[hooks]] blocks and all non-managed hooks.
     */
    private rebuildToml;
}
export {};
