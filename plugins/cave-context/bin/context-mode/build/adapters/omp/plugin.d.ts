/**
 * Oh My Pi (OMP) plugin entry point for context-mode.
 *
 * Mirrors the Pi extension shape (`src/adapters/pi/extension.ts`) for
 * the four OMP hook events that materially protect the context window
 * and persist session continuity:
 *
 *   - session_start         — initialize the session row in our DB
 *   - tool_call             — hard-block curl/wget/inline-HTTP in bash
 *   - tool_result           — extract structured events into the session DB
 *   - session_before_compact — persist a resume snapshot before compaction
 *
 * Loaded by OMP via the `omp` (or `pi`) field in package.json — see
 * upstream loader at refs/platforms/oh-my-pi/packages/coding-agent/src/
 * extensibility/plugins/loader.ts:75:
 *   `const manifest: PluginManifest | undefined = pluginPkg.omp || pluginPkg.pi;`
 * Hook factory contract from refs/.../extensibility/hooks/types.ts:809:
 *   `export type HookFactory = (pi: HookAPI) => void;`
 *
 * OMP differs from Pi in two ways that justify a dedicated plugin file:
 *   1. Storage roots at ~/.omp/context-mode/ via OMPAdapter, not ~/.pi/
 *   2. OMP has native MCP support (mcp.json), so no MCP bridge is needed
 *      — the bridge that Pi's extension ships (mcp-bridge.ts) is dead weight
 *      under OMP and is intentionally omitted here.
 */
export declare function _resetOmpPluginStateForTests(): void;
/**
 * Return the current session ID picked by the most recent session_start
 * handler. Test-only — production code reads `_sessionId` directly via
 * the closure. The shared SQLite DB at `~/.omp/context-mode/` survives
 * between tests, so `getLatestSessionId()` cannot disambiguate which
 * row belongs to "this" test when multiple tests insert in the same
 * second; tests use this getter instead.
 */
export declare function _getOmpPluginSessionIdForTests(): string;
type ToolCallEvent = {
    toolName: string;
    toolCallId?: string;
    input?: Record<string, unknown>;
};
type ToolResultEvent = {
    toolName: string;
    toolCallId?: string;
    input?: Record<string, unknown>;
    content?: Array<{
        type: string;
        text?: string;
    }>;
    isError?: boolean;
};
type ToolCallEventResult = {
    block?: boolean;
    reason?: string;
};
type HookEventCtx = Record<string, unknown> | undefined;
type HookHandler<E, R = void> = (event: E, ctx: HookEventCtx) => R | undefined | Promise<R | undefined>;
export interface MinimalHookAPI {
    on(event: "session_start", handler: HookHandler<{
        type: "session_start";
    }>): void;
    on(event: "session_before_compact", handler: HookHandler<{
        type: "session_before_compact";
    }>): void;
    on(event: "tool_call", handler: HookHandler<ToolCallEvent, ToolCallEventResult>): void;
    on(event: "tool_result", handler: HookHandler<ToolResultEvent>): void;
    on(event: string, handler: (...args: unknown[]) => unknown): void;
}
/**
 * OMP plugin default export. Called once by the OMP runtime per
 * upstream `extensibility/plugins/loader.ts` after `omp plugin install
 * context-mode`. Subsequent `pi.on(...)` registrations route the four
 * lifecycle events to our SessionDB-backed handlers below.
 */
export default function ompPlugin(pi: MinimalHookAPI): void;
export {};
