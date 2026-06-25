/**
 * MCP-stdio bridge for the Pi Coding Agent extension.
 *
 * Pi 0.73.x has no native MCP support — its README is explicit:
 *   > "No MCP. Build CLI tools with READMEs (see Skills), or build an
 *   >  extension that adds MCP support."
 *
 * Without this bridge, the routing block tells the LLM to call
 * `ctx_execute`, `ctx_search`, etc. — but those tools never enter Pi's
 * tool list, so the LLM cannot reach them. context-mode then becomes a
 * pure cost on Pi (~2.5K tokens of system-prompt overhead with 0
 * actual ctx_* calls). Reported in mksglu/context-mode#426.
 *
 * The bridge spawns `server.bundle.mjs` as a long-lived child via stdio
 * JSON-RPC, performs the MCP handshake, calls `tools/list` once, and
 * registers each returned tool through `pi.registerTool({ … })`. Each
 * tool's `execute()` forwards into the child via `tools/call` — same
 * code path Claude Code, Gemini CLI, and the other adapters use, so
 * Pi behavior matches the rest of the platform suite.
 *
 * No external dependencies — pure node:child_process + JSON line frames.
 */
export interface ResolveDeps {
    detect?: () => {
        javascript: string | null;
    };
    which?: (cmd: string) => string | null;
    execPath?: string;
}
/**
 * Resolve a JS runtime safe to spawn the MCP server with.
 *
 * Returns `null` when no real runtime is reachable (caller must skip
 * the bridge gracefully — see bootstrapMCPTools). Pi-named binaries are
 * explicitly rejected at every step to prevent the #516 fork bomb.
 */
export declare function resolveJsRuntimeForBridge(deps?: ResolveDeps): string | null;
export interface MCPTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}
export interface MCPCallResult {
    content?: Array<{
        type?: string;
        text?: string;
    }>;
    isError?: boolean;
}
export declare class PiTextComponent {
    private text;
    constructor(text?: string);
    setText(text: string): void;
    invalidate(): void;
    render(width: number): string[];
}
export declare function truncateAnsiLine(line: string, maxWidth: number): string;
interface PiRenderTheme {
    bold(text: string): string;
    fg(color: string, text: string): string;
}
interface PiRenderContext {
    lastComponent?: unknown;
}
/**
 * Minimal stdio JSON-RPC client targeting the context-mode MCP server.
 *
 * Implementation notes:
 *   - One outstanding ID per request; results matched by `id` from the
 *     returned envelope. Notifications (no id) are sent fire-and-forget.
 *   - Buffer is split on `\n` because the MCP server writes one
 *     newline-delimited JSON message per `console.log` / `stdout.write`
 *     invocation — this is the standard MCP stdio transport framing.
 *   - On child exit / error, every in-flight request is rejected so
 *     callers do not hang forever.
 */
export declare class MCPStdioClient {
    private readonly serverScript;
    private readonly env;
    private readonly runtimeOverride;
    private child;
    private requestId;
    private readonly pending;
    private buffer;
    private initialized;
    private exited;
    /**
     * In-flight respawn promise — set while {@link respawn} runs so
     * concurrent callers awaiting `request()` after an idle exit observe
     * the SAME respawn, not N parallel ones. Without this guard, two
     * simultaneous `callTool` calls would each see `this.exited === true`,
     * each fire their own `respawn()`, and the loser leaks an orphaned
     * child process the GC cannot reach (no `.kill()` reference).
     */
    private respawnPromise;
    /**
     * Live env passed to the spawned child — exposed (read-only intent)
     * so tests can pin the fork-bomb-prevention env counter (#516)
     * without needing to attach a process-tree probe.
     */
    _spawnEnv: NodeJS.ProcessEnv | null;
    constructor(serverScript: string, env?: NodeJS.ProcessEnv, runtimeOverride?: string | null);
    /** Spawn the MCP child. Idempotent. */
    start(): void;
    private onExit;
    private onData;
    request<T = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<T>;
    private writeFrame;
    notify(method: string, params: unknown): void;
    initialize(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(name: string, args: unknown): Promise<MCPCallResult>;
    /**
     * Respawn the MCP child after an exit (clean shutdown or crash).
     * Resets state so a fresh `start()` + `initialize()` cycle runs, then
     * the caller's pending request flows through the new child.
     *
     * Single-flight — concurrent callers share one in-flight respawn via
     * {@link respawnPromise}. Internal — only entered via {@link request}.
     *
     * Sequencing pinned (do not reorder without updating the regression
     * test in tests/adapters/pi-mcp-bridge.test.ts):
     *   1. `this.child = null`     — drop stale handle
     *   2. `this.buffer = ""`       — discard leftover bytes from old child
     *   3. `this.exited = false`    — must precede `start()` + `initialize()`,
     *                                 because `request("initialize", …)`
     *                                 inside `initialize()` re-checks this
     *                                 flag and would otherwise re-enter
     *                                 respawn in an infinite loop
     *   4. `this.initialized = false`
     *   5. `this.start()`
     *   6. `await this.initialize()` — flows through `request()` recursively
     */
    private respawn;
    shutdown(): void;
}
/**
 * Subset of the Pi ExtensionAPI we touch. Typed structurally so we don't
 * pull `@earendil-works/pi-coding-agent` as a build dependency — keeps
 * the bundle size unchanged and matches the existing pi-extension.ts
 * style (which also types `pi` as `any`).
 */
export interface PiToolRegistration {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    renderCall?: (args: unknown, theme: PiRenderTheme, context: PiRenderContext) => unknown;
    renderResult?: (result: MCPCallResult, options: {
        expanded: boolean;
        isPartial: boolean;
    }, theme: PiRenderTheme, context: PiRenderContext) => unknown;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{
        content: Array<{
            type: "text";
            text: string;
        }>;
        details: Record<string, unknown>;
        isError?: boolean;
    }>;
}
export interface PiLikeAPI {
    registerTool: (tool: PiToolRegistration) => void;
}
/** Result of bootstrapping the bridge. */
export interface BridgeHandle {
    /** Names of tools registered with Pi (for diagnostics / tests). */
    tools: string[];
    /** Idempotent shutdown — terminates the MCP child. */
    shutdown: () => void;
    /** Underlying client, exposed for tests / advanced callers. */
    client: MCPStdioClient;
}
/**
 * Spawn the MCP server and register each of its tools with Pi via
 * `pi.registerTool()`. The same JSON Schema returned by `tools/list` is
 * passed straight through as `parameters` — TypeBox emits JSON-Schema
 * compatible objects, so any Pi runtime that validates JSON Schema
 * accepts this shape (verified against pi 0.73.x).
 *
 * Errors during MCP `tools/call` are translated to a `throw` from the
 * `execute()` callback — Pi's contract is "throw to mark the tool call
 * failed", which lets the LLM see and adapt.
 */
export interface BootstrapOptions {
    env?: NodeJS.ProcessEnv;
    /** DI hook for tests: override the runtime resolver entirely. */
    _resolveJsRuntime?: () => string | null;
}
export declare function bootstrapMCPTools(pi: PiLikeAPI, serverScript: string, options?: BootstrapOptions): Promise<BridgeHandle>;
export {};
