/**
 * adapters/gemini-cli — Gemini CLI platform adapter.
 *
 * Implements HookAdapter for Gemini CLI's JSON stdin/stdout hook paradigm.
 *
 * Gemini CLI hook specifics:
 *   - I/O: JSON on stdin, JSON on stdout (same paradigm as Claude Code)
 *   - Hook names: BeforeTool, AfterTool, PreCompress, SessionStart
 *   - Arg modification: `hookSpecificOutput.tool_input` (merged with original)
 *   - Blocking: `decision: "deny"` in response (NOT permissionDecision)
 *   - Output modification: `decision: "deny"` + reason replaces output,
 *     `hookSpecificOutput.additionalContext` appends
 *   - PreCompress: advisory only (async, cannot block)
 *   - No `decision: "ask"` support
 *   - Hooks don't fire for subagents yet
 *   - Config: ~/.gemini/settings.json (user), .gemini/settings.json (project)
 *   - Session ID: session_id field
 *   - Project dir env: GEMINI_PROJECT_DIR (also CLAUDE_PROJECT_DIR alias)
 *   - Session dir: ~/.gemini/context-mode/sessions/
 */
import { BaseAdapter } from "../base.js";
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, HealthCheck, PreToolUseEvent, PostToolUseEvent, PreCompactEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, PreCompactResponse, SessionStartResponse, HookRegistration } from "../types.js";
export declare class GeminiCLIAdapter extends BaseAdapter implements HookAdapter {
    constructor();
    readonly name = "Gemini CLI";
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
    getInstructionFiles(): string[];
    generateHookConfig(pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(settings: Record<string, unknown>): void;
    validateHooks(pluginRoot: string): DiagnosticResult[];
    /**
     * Adapter-defined health checks (Algo-D1) — mirrors claude-code's override
     * at src/adapters/claude-code/index.ts:275.
     *
     * Issue #712 motivation: gemini-cli's hook scripts ship under
     * `<pluginRoot>/hooks/gemini-cli/<scriptName>` (see HOOK_MAP in
     * src/cli.ts and `setHookPermissions` in this file). The legacy doctor
     * path (`getHookScriptPaths` -> `extractHookScriptPath`) round-trips
     * through `buildHookCommand` -> command-string parsing, so a missing
     * platform subdir in the emit was invisible to the doctor until a user
     * installed globally and observed FAIL lines. This override drops the
     * round-trip: HOOK_SCRIPTS is the single source of truth and we probe
     * `existsSync(join(pluginRoot, "hooks", "gemini-cli", scriptName))`
     * directly, so a future regression in the command emit cannot make the
     * doctor lie about hook health.
     *
     * Adding a new hook event in HOOK_SCRIPTS auto-extends doctor coverage
     * here — no parallel hardcoded list to maintain.
     */
    getHealthChecks(pluginRoot: string): readonly HealthCheck[];
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    configureAllHooks(pluginRoot: string): string[];
    setHookPermissions(pluginRoot: string): string[];
    updatePluginRegistry(pluginRoot: string, version: string): void;
    /**
     * Resolve the project directory for a Gemini CLI hook input.
     * Priority: input.cwd > GEMINI_PROJECT_DIR > CLAUDE_PROJECT_DIR > process.cwd().
     * Mirrors the cursor / opencode pattern so downstream hooks always
     * receive a defined projectDir even when the platform omits cwd
     * from the wire payload (e.g. under worktrees).
     */
    private getProjectDir;
    /**
     * Extract session ID from Gemini CLI hook input.
     * Priority: session_id field > env fallback > ppid fallback.
     */
    private extractSessionId;
}
