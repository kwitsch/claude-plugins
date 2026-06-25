/**
 * adapters/claude-code — Claude Code platform adapter.
 *
 * Extends ClaudeCodeBaseAdapter (shared wire-protocol parse/format methods)
 * with Claude Code-specific configuration, diagnostics, and upgrade logic.
 *
 * Claude Code hook specifics:
 *   - Session ID: transcript_path UUID > session_id > CLAUDE_SESSION_ID > ppid
 *   - Config root: $CLAUDE_CONFIG_DIR (when set) or ~/.claude
 *   - Settings: <configDir>/settings.json
 *   - Session dir: <configDir>/context-mode/sessions/
 *   - Plugin registry: <configDir>/plugins/installed_plugins.json
 */
import { ClaudeCodeBaseAdapter, type ClaudeCodeWireInput } from "../claude-code-base.js";
import { type HookAdapter, type HookParadigm, type PlatformCapabilities, type DiagnosticResult, type HookRegistration, type HealthCheck } from "../types.js";
export declare class ClaudeCodeAdapter extends ClaudeCodeBaseAdapter implements HookAdapter {
    constructor();
    readonly name = "Claude Code";
    readonly paradigm: HookParadigm;
    protected readonly projectDirEnvVar = "CLAUDE_PROJECT_DIR";
    readonly capabilities: PlatformCapabilities;
    /**
     * Honor `CLAUDE_CONFIG_DIR` (the canonical Claude Code config root) before
     * falling back to `~/.claude`. Mirrors the contract that
     * `hooks/session-helpers.mjs::resolveConfigDir` already follows — including
     * tilde expansion for shells that pass `~/foo` through unchanged — so server
     * and hooks agree on where session-scoped state lives. See issue #453.
     *
     * Tilde regex `/^~[/\\]?/` only handles the current-user form (`~`, `~/`,
     * `~\`); `~user/` is NOT expanded to a per-user homedir (matches
     * `resolveConfigDir`). Non-tilde values are run through `resolve()` to
     * normalize relative paths to absolute against cwd; the hook helper
     * intentionally leaves them raw, but the adapter contract guarantees an
     * absolute path (BaseAdapter.getConfigDir docstring).
     *
     * Issue #460 round-3: routed through the canonical
     * `resolveClaudeConfigDir` util so server, CLI, security, and adapter
     * agree byte-for-byte (incl. empty/whitespace-only env fallback).
     */
    getConfigDir(_projectDir?: string): string;
    getSessionDir(): string;
    getSettingsPath(): string;
    generateHookConfig(pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(settings: Record<string, unknown>): void;
    validateHooks(pluginRoot: string): DiagnosticResult[];
    /**
     * Adapter-defined health checks (Algo-D1 + Algo-D5).
     *
     * For each entry in HOOK_SCRIPTS (the canonical hookType → scriptName
     * map), emit a HealthCheck that joins `pluginRoot + "hooks" +
     * scriptName` and probes via `existsSync`. Crucially, this NEVER
     * parses a hook command — pluginRoot and scriptName are both in our
     * hand, so the regex round-trip that produced the #548 doubled-path
     * FAIL is bypassed entirely.
     *
     * The hook check derives from HOOK_SCRIPTS (single source of truth in
     * src/adapters/claude-code/hooks.ts), so adding a new hook event in
     * that map auto-extends doctor coverage — no parallel hardcoded list
     * to maintain.
     *
     * Algo-D5: appends a single "Plugin cache integrity" check that
     * delegates to the same helper start.mjs uses at boot
     * (scripts/plugin-cache-integrity.mjs::assertPluginCacheIntegrity).
     * Same code, two callsites — boot fail-fast and doctor diagnostic
     * agree byte-for-byte. Users hitting #550 get the actionable signal
     * without restarting the MCP server.
     */
    getHealthChecks(pluginRoot: string): readonly HealthCheck[];
    /** Read plugin hooks from hooks/hooks.json or .claude-plugin/hooks/hooks.json */
    private readPluginHooks;
    /** Check if a hook type is configured in either settings.json or plugin hooks */
    private checkHookType;
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    configureAllHooks(pluginRoot: string): string[];
    setHookPermissions(pluginRoot: string): string[];
    updatePluginRegistry(pluginRoot: string, version: string): void;
    protected extractSessionId(input: ClaudeCodeWireInput): string;
}
