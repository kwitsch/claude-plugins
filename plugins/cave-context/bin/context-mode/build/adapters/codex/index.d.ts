/**
 * adapters/codex — Codex CLI platform adapter.
 *
 * Implements HookAdapter for Codex CLI's JSON stdin/stdout paradigm.
 *
 * Codex CLI hook specifics:
 *   - 6 hook events: PreToolUse, PostToolUse, PreCompact, SessionStart, UserPromptSubmit, Stop
 *   - Same wire protocol as Claude Code (JSON stdin → stdout)
 *   - Config: $CODEX_HOME or ~/.codex (hooks.json + config.toml)
 *   - Session dir: $CODEX_HOME/context-mode/sessions/
 *
 * Hook dispatch is stable in Codex CLI. PreToolUse deny decisions work,
 * while input rewriting remains blocked on upstream updatedInput support.
 * Track: https://github.com/openai/codex/issues/18491
 */
import { BaseAdapter } from "../base.js";
import { type HookAdapter, type HookParadigm, type PlatformCapabilities, type DiagnosticResult, type PreToolUseEvent, type PostToolUseEvent, type PreCompactEvent, type SessionStartEvent, type PreToolUseResponse, type PostToolUseResponse, type PreCompactResponse, type SessionStartResponse, type HookRegistration } from "../types.js";
type CodexVersionRunner = (file: string, args: string[], options: {
    encoding: BufferEncoding;
    stdio: ["ignore", "pipe", "ignore"];
    timeout: number;
}) => string | Buffer;
export declare function probeCodexCliVersion(runCommand?: CodexVersionRunner): string | null;
export declare class CodexAdapter extends BaseAdapter implements HookAdapter {
    constructor();
    readonly name = "Codex CLI";
    readonly paradigm: HookParadigm;
    readonly capabilities: PlatformCapabilities;
    parsePreToolUseInput(raw: unknown): PreToolUseEvent;
    parsePostToolUseInput(raw: unknown): PostToolUseEvent;
    parsePreCompactInput(raw: unknown): PreCompactEvent;
    parseSessionStartInput(raw: unknown): SessionStartEvent;
    formatPreToolUseResponse(response: PreToolUseResponse): unknown;
    formatPostToolUseResponse(response: PostToolUseResponse): unknown;
    formatPreCompactResponse(response: PreCompactResponse): unknown;
    formatSessionStartResponse(response: SessionStartResponse): unknown;
    getConfigDir(_projectDir?: string): string;
    getSettingsPath(): string;
    getSessionDir(): string;
    getInstructionFiles(): string[];
    getMemoryDir(projectDir?: string): string;
    generateHookConfig(_pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(_settings: Record<string, unknown>): void;
    validateHooks(pluginRoot: string): DiagnosticResult[];
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    configureAllHooks(pluginRoot: string): string[];
    backupSettings(): string | null;
    setHookPermissions(_pluginRoot: string): string[];
    updatePluginRegistry(_pluginRoot: string, _version: string): void;
    getRoutingInstructions(): string;
    /**
     * Resolve the project directory for a Codex hook input.
     * Priority: input.cwd > CODEX_PROJECT_DIR env > process.cwd().
     * Mirrors the cursor / opencode pattern so downstream hooks always
     * receive a defined projectDir even under worktrees or when the
     * platform omits cwd from the wire payload.
     */
    private getProjectDir;
    getHooksPath(): string;
    private backupFile;
    private readHooksConfig;
    private writeHooksConfig;
    private upsertManagedHookEntry;
    private removeManagedHookEntries;
    private hasCodexPluginHookManifest;
    private pruneStaleUserHookTrustState;
    private isExpectedHookEntry;
    private isManagedContextModeEntry;
    private entryContainsManagedCommand;
    private normalizeCommand;
    /**
     * Extract session ID from Codex CLI hook input.
     * Priority: session_id field > fallback to ppid.
     */
    private extractSessionId;
}
export {};
