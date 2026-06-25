/**
 * adapters/openclaw — OpenClaw platform adapter.
 *
 * Implements HookAdapter for OpenClaw's TypeScript plugin paradigm.
 *
 * OpenClaw hook specifics:
 *   - I/O: TS plugin functions via api.registerHook() and api.on()
 *   - Hook events: tool_call:before, tool_call:after, command:new
 *   - Lifecycle: before_prompt_build (routing instruction injection)
 *   - Context engine: api.registerContextEngine() with ownsCompaction
 *   - Arg modification: mutate event.params in tool_call:before
 *   - Blocking: return { block: true, blockReason } from tool_call:before
 *   - Session ID: event context (no specific env var)
 *   - Project dir: process.cwd()
 *   - Config: openclaw.json plugins.entries, ~/.openclaw/extensions/
 *   - Session dir: ~/.openclaw/context-mode/sessions/
 */
import { BaseAdapter } from "../base.js";
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, PreToolUseEvent, PostToolUseEvent, PreCompactEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, PreCompactResponse, SessionStartResponse, HookRegistration } from "../types.js";
export declare class OpenClawAdapter extends BaseAdapter implements HookAdapter {
    constructor();
    readonly name = "OpenClaw";
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
    getSettingsPath(): string;
    /**
     * OpenClaw stores everything in the project root — no separate config
     * dir. Returned as the absolute project directory itself per the
     * HookAdapter.getConfigDir contract (always-absolute).
     */
    getConfigDir(projectDir?: string): string;
    getInstructionFiles(): string[];
    /**
     * Absolute <projectRoot>/memory directory.
     *
     * OpenClaw's `getConfigDir(projectDir)` already returns the project root,
     * so the memory dir is naturally project-scoped per the OpenClaw
     * convention. The `projectDir` parameter is honored for explicit
     * resolution; without it, falls back to the implicit `process.cwd()`
     * inside `getConfigDir`. Either way, two projects never share a path
     * — no hash suffix needed (issue #663).
     */
    getMemoryDir(projectDir?: string): string;
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
     * Resolve the project directory for an OpenClaw hook input.
     * Priority: input.cwd > OPENCLAW_PROJECT_DIR env > process.cwd().
     * Mirrors the cursor / opencode pattern so downstream hooks always
     * receive a defined projectDir even under worktrees or when the
     * platform omits cwd from the wire payload.
     */
    private getProjectDir;
    /**
     * Extract session ID from OpenClaw hook input.
     */
    private extractSessionId;
}
