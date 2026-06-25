#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { ContentStore } from "./store.js";
import { type PlatformId } from "./adapters/types.js";
export declare const server: McpServer;
export interface RegisteredCtxTool {
    name: string;
    config: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}
export declare const REGISTERED_CTX_TOOLS: RegisteredCtxTool[];
export declare function shouldSuppressMcpToolsForNativePluginHost(opts?: {
    embedded?: string;
    platform?: PlatformId;
    settings?: Record<string, unknown> | null;
}): boolean;
export declare function emitSuppressionDiagnostic(opts?: {
    platform?: string;
    write?: (chunk: string) => void;
}): void;
/** Test-only: reset the one-shot emission flag so suites can re-exercise. */
export declare function __resetSuppressionDiagnosticForTests(): void;
/**
 * Issue #637 — register an explicit empty `tools/list` handler on the McpServer.
 *
 * Background: when `suppressMcpToolsForNativePluginHost` is true, every
 * `server.registerTool()` call is short-circuited (returns `undefined` above).
 * The MCP SDK only installs the SDK-default `tools/list` handler when at least
 * one `registerTool()` reaches `setToolRequestHandlers()` internally
 * (mcp.js:56-67). Suppressing every registration leaves `tools/list`
 * unregistered, and the framework's RPC layer answers it with
 * `-32601 "Method not found"`.
 *
 * The reporter of #637 (SquirrelRat) inspected the suppressed child via
 * `tools/list` and read the JSON-RPC error as "the plugin never registers any
 * ctx_* tools" — when in fact the plugin DOES register all 11 tools natively
 * (verified at `src/adapters/opencode/plugin.ts:469` and
 * `tests/opencode-plugin.test.ts:88`). The misleading -32601 is the seed of
 * the #637 perception.
 *
 * This helper installs an explicit handler that returns `{tools: []}` — a
 * spec-compliant empty list. Paired with the existing #623 stderr diagnostic,
 * an operator now sees:
 *   - wire response: `{tools: []}` (matches expectation, no JSON-RPC error)
 *   - stderr: `[context-mode] ctx_* tools/list intentionally empty… (#623)`
 *
 * Idempotent: throws inside SDK if called twice on the same server because
 * `assertCanSetRequestHandler` (mcp.js:60) rejects duplicate registrations;
 * we therefore install the SDK's default tool handlers FIRST (via a no-op
 * registerTool of a fake tool, immediately removed) only if needed. To keep
 * the public surface minimal, we just call `server.server.setRequestHandler`
 * directly — that is the same low-level call used for prompts/resources at
 * server.ts:259-261 and avoids the SDK guard entirely.
 *
 * Exported for test (#637 in-memory regression guard).
 */
export declare function registerEmptyToolsListHandler(target?: McpServer): void;
type ToolContextOverride = {
    projectDir: string;
    sessionId?: string;
};
export declare function withProjectDirOverride<T>(projectDir: string | ToolContextOverride, fn: () => Promise<T>): Promise<T>;
/**
 * Build the FK-attribution object passed to every ContentStore.index*() call
 * in this process. CLAUDE_SESSION_ID is the only MCP-side handle we have on
 * the current session — eventId stays undefined because MCP tool invocations
 * are not paired with PostToolUse event rows at index time (the hook fires
 * AFTER the tool returns). Empty-string fallback inside #insertChunks keeps
 * legacy unattributed rows readable.
 */
export declare function currentAttribution(): {
    sessionId?: string;
} | undefined;
/** v1.0.134 SLICE A: opts injection for testability. Production callers pass nothing. */
export declare function resolveSessionIdFromSessionDB(opts?: {
    projectDir?: string;
    sessionsDir?: string;
    bypassCache?: boolean;
}): string | undefined;
/**
 * Project directory detection across supported platforms.
 *
 * Priority:
 *   1. Platform-specific env var (set by host IDE before MCP server spawn)
 *   2. CONTEXT_MODE_PROJECT_DIR (set by start.mjs for ALL platforms — universal)
 *   3. process.cwd() (last resort)
 *
 * CONTEXT_MODE_PROJECT_DIR guarantees correct projectDir even for platforms
 * that don't set their own env var (Cursor, OpenClaw, Codex, Kiro, Zed).
 */
export declare function getProjectDir(): string;
/**
 * Parse FTS5 highlight markers to find match positions in the
 * original (marker-free) text. Returns character offsets into the
 * stripped content where each matched token begins.
 */
export declare function positionsFromHighlight(highlighted: string): number[];
export declare function extractSnippet(content: string, query: string, maxLen?: number, highlighted?: string): string;
export type BatchQueryScope = "batch" | "global";
export declare function formatBatchQueryResults(store: ContentStore, queries: string[], source: string, maxOutput?: number, scope?: BatchQueryScope): string[];
export interface BatchCommand {
    label: string;
    command: string;
}
export interface BatchRunResult {
    outputs: string[];
    timedOut: boolean;
}
export interface BatchRunOptions {
    /**
     * Total budget (concurrency=1, shared) or per-command (concurrency>1).
     * When `undefined`, no server-side timer fires — the MCP host's RPC
     * timeout governs (Issue #406).
     */
    timeout: number | undefined;
    concurrency: number;
    nodeOptsPrefix: string;
    onFsBytes?: (bytes: number) => void;
}
interface BatchExecutor {
    execute(input: {
        language: "shell";
        code: string;
        timeout: number | undefined;
    }): Promise<{
        stdout: string;
        timedOut?: boolean;
    }>;
}
export declare function buildBatchNodeOptionsPrefix(shellPath: string, preloadPath: string): string;
/**
 * Execute batch commands. concurrency=1 preserves the legacy serial path
 * (shared timeout budget + cascading skip-on-timeout). concurrency>1 runs
 * commands concurrently with at most N in flight; each command receives the
 * full timeout, output is collated by input index, and per-command timeouts
 * record `(timed out)` blocks without skipping siblings.
 */
export declare function runBatchCommands(commands: BatchCommand[], opts: BatchRunOptions, executor: BatchExecutor): Promise<BatchRunResult>;
export declare function buildFetchCode(url: string, outputPath: string): string;
/**
 * Classify an IP address.
 *   - "block":    always blocked (link-local/IMDS/multicast/reserved/malformed)
 *   - "private":  loopback or RFC1918 — allowed by default, blocked in strict mode
 *   - "public":   safe to fetch
 *
 * Exported (via the function name) so SSRF tests can exercise the matcher directly.
 */
export declare function classifyIp(rawIp: string): "block" | "private" | "public";
export type SpawnSyncFn = (cmd: string, args: readonly string[], opts?: SpawnSyncOptions) => SpawnSyncReturns<string | Buffer>;
export type BrowserOpenResult = {
    ok: true;
    method: string;
} | {
    ok: false;
    method: "none";
    reason: string;
};
export type KillResult = {
    killedPids: string[];
    attemptedPids: string[];
    errors: string[];
};
export declare function browserOpenArgv(url: string, platform: NodeJS.Platform): readonly {
    cmd: string;
    args: readonly string[];
}[];
export declare function openBrowserSync(url: string, platform?: NodeJS.Platform, runner?: SpawnSyncFn): BrowserOpenResult;
export declare function killProcessOnPort(port: number, platform?: NodeJS.Platform, runner?: SpawnSyncFn): KillResult;
export {};
