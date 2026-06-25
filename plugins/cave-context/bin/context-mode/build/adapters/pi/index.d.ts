/**
 * adapters/pi — Pi coding agent platform adapter.
 *
 * Implements HookAdapter for Pi's MCP-only paradigm at the adapter layer.
 *
 * Pi hook specifics:
 *   - NO JSON-stdio hooks. Pi exposes a JS-callback runtime API
 *     (`pi.on("session_start", fn)`, `pi.on("tool_call", fn)`, …) which is
 *     wired DIRECTLY by `src/adapters/pi/extension.ts`. The HookAdapter
 *     contract here intentionally reports `mcp-only` and all-false
 *     capabilities so harness paths that walk the JSON-stdio matrix do not
 *     try to register stdio hooks for Pi.
 *   - Config root: ~/.pi/
 *   - Settings: ~/.pi/settings.json (kept lightweight — Pi does not
 *     prescribe a canonical settings file, but several internal tools
 *     write one; using settings.json keeps parity with Claude Code).
 *   - Session dir: ~/.pi/context-mode/sessions/  (parallel to ~/.claude/,
 *     ~/.omp/) — this is the data-isolation contract from issue #473.
 *   - Instruction file: AGENTS.md (per configs/pi/AGENTS.md).
 *
 * Why a dedicated adapter is mandatory:
 *   Before this adapter existed, `getAdapter("pi")` fell through to the
 *   `default` arm of the switch in `src/adapters/detect.ts` and returned a
 *   ClaudeCodeAdapter. Pi sessions therefore wrote DBs and event logs into
 *   `~/.claude/context-mode/sessions/`, contaminating Claude Code state and
 *   silently leaking Pi user data into the wrong storage root (issue #473
 *   follow-up). The OMP adapter fixed the same class of bug for OMP; this
 *   adapter closes the gap for Pi.
 */
import { BaseAdapter } from "../base.js";
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, PreToolUseEvent, PostToolUseEvent, PreCompactEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, PreCompactResponse, SessionStartResponse, HookRegistration } from "../types.js";
export declare class PiAdapter extends BaseAdapter implements HookAdapter {
    constructor();
    readonly name = "Pi";
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
