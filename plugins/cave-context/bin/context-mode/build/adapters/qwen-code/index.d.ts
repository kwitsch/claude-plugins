/**
 * adapters/qwen-code — Qwen Code platform adapter.
 *
 * Extends ClaudeCodeBaseAdapter (shared wire-protocol parse/format methods)
 * with Qwen Code-specific configuration, diagnostics, and session ID logic.
 *
 * Differences from Claude Code:
 *   - Config dir: ~/.qwen/ (not ~/.claude/)
 *   - Env vars: QWEN_PROJECT_DIR, QWEN_SESSION_ID (not CLAUDE_*)
 *   - Session ID priority: session_id field first (Claude: transcript_path first)
 *   - No plugin registry (Qwen uses settings.json directly)
 *   - MCP clientInfo: qwen-cli-mcp-client-* (pattern)
 *   - 12 hook events (superset of Claude's 5, but context-mode uses the shared 5)
 */
import { ClaudeCodeBaseAdapter, type ClaudeCodeWireInput } from "../claude-code-base.js";
import { type HookAdapter, type HookParadigm, type PlatformCapabilities, type DiagnosticResult, type HookRegistration } from "../types.js";
export declare class QwenCodeAdapter extends ClaudeCodeBaseAdapter implements HookAdapter {
    constructor();
    readonly name = "Qwen Code";
    readonly paradigm: HookParadigm;
    protected readonly projectDirEnvVar = "QWEN_PROJECT_DIR";
    readonly capabilities: PlatformCapabilities;
    getSettingsPath(): string;
    getInstructionFiles(): string[];
    generateHookConfig(pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(settings: Record<string, unknown>): void;
    validateHooks(_pluginRoot: string): DiagnosticResult[];
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    configureAllHooks(pluginRoot: string): string[];
    setHookPermissions(_pluginRoot: string): string[];
    updatePluginRegistry(_pluginRoot: string, _version: string): void;
    getRoutingInstructionsConfig(): {
        instructionsPath: string;
        targetPath: string;
        platformName: string;
    };
    protected extractSessionId(input: ClaudeCodeWireInput): string;
}
