/**
 * adapters/omp — Oh My Pi (OMP) platform adapter.
 *
 * OMP integration facts (verified against can1357/oh-my-pi @ v3.20.1):
 *   - MCP config: `~/.omp/agent/mcp.json` (global) or `<project>/.omp/mcp.json`
 *     (project), per `packages/utils/src/dirs.ts` `getMCPConfigPath()` and
 *     `docs/mcp-config.md` "Preferred config locations".
 *   - Agent-dir env override: `PI_CODING_AGENT_DIR` — `packages/utils/src/dirs.ts`:
 *     `let dirs = new DirResolver(process.env.PI_CODING_AGENT_DIR);`
 *     (No `OMP_*` runtime env exists; `.env`-file `OMP_*` keys are mirrored to
 *     `PI_*` BEFORE process.env is read.)
 *   - System-prompt file: `SYSTEM.md` (project `.omp/SYSTEM.md` precedence,
 *     global `~/.omp/agent/SYSTEM.md` fallback). NOT `PI.md` — no `PI.md`
 *     loader exists upstream. OMP also auto-discovers `AGENTS.md` via
 *     `packages/coding-agent/src/discovery/agents-md.ts`.
 *   - Hook surface: OMP DOES expose pre/post tool-call hooks
 *     (`~/.omp/agent/hooks/{pre,post}/*.ts`, `omp.on("tool_call", ...)`).
 *     This adapter ships MCP-only delivery for now; wiring native OMP
 *     hooks is future work tracked separately.
 *
 * Why a dedicated adapter rather than reusing pi:
 *   OMP and Pi share a runtime surface but different storage roots
 *   (`~/.omp/agent/` vs `~/.pi/`). Without an OMP adapter, OMP users
 *   running through a Claude-installed harness silently land their
 *   context-mode data under `~/.claude/context-mode/` (issue #473).
 */
import { BaseAdapter } from "../base.js";
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, PreToolUseEvent, PostToolUseEvent, PreCompactEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, PreCompactResponse, SessionStartResponse, HookRegistration } from "../types.js";
export declare class OMPAdapter extends BaseAdapter implements HookAdapter {
    constructor();
    readonly name = "OMP";
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
    /**
     * Resolve OMP agent root, honoring `PI_CODING_AGENT_DIR` when set
     * (the upstream OMP convention — see `packages/utils/src/dirs.ts`)
     * and falling back to `~/.omp/agent`.
     */
    private getAgentDir;
    getSettingsPath(): string;
    /**
     * OMP nests its config under the agent dir. Always absolute.
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
