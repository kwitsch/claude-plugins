/**
 * OpenClaw TypeScript plugin entry point for context-mode.
 *
 * Exports an object with { id, name, configSchema, register(api) } for
 * declarative metadata and config validation before code execution.
 *
 * register(api) registers:
 *   - before_tool_call hook   — Routing enforcement (deny/modify/passthrough)
 *   - after_tool_call hook    — Session event capture
 *   - command:new hook         — Session initialization and cleanup
 *   - session_start hook             — Re-key DB session to OpenClaw's session ID
 *   - before_compaction hook         — Flush events to resume snapshot
 *   - after_compaction hook          — Increment compact count
 *   - before_prompt_build (p=10)  — Resume snapshot injection into system context
 *   - before_prompt_build (p=5)   — Routing instruction injection into system context
 *   - context-mode engine      — Context engine with compaction management
 *   - /ctx-stats command       — Auto-reply command for session statistics
 *   - /ctx-doctor command      — Auto-reply command for diagnostics
 *   - /ctx-upgrade command     — Auto-reply command for upgrade
 *
 * Loaded by OpenClaw via: openclaw.extensions entry in package.json
 *
 * OpenClaw plugin paradigm:
 *   - Plugins export { id, name, configSchema, register(api) } for metadata
 *   - api.registerHook() for event-driven hooks
 *   - api.on() for typed lifecycle hooks
 *   - api.registerContextEngine() for compaction ownership
 *   - api.registerCommand() for auto-reply slash commands
 *   - Plugins run in-process with the Gateway (trusted code)
 */
import type { OpenClawToolDef } from "./openclaw/mcp-tools.js";
/** Context for auto-reply command handlers. */
interface CommandContext {
    senderId?: string;
    channel?: string;
    isAuthorizedSender?: boolean;
    args?: string;
    commandBody?: string;
    config?: Record<string, unknown>;
}
/** OpenClaw plugin API provided to the register function. */
interface OpenClawPluginApi {
    registerHook(event: string, handler: (...args: unknown[]) => unknown, meta: {
        name: string;
        description: string;
    }): void;
    /**
     * Register a typed lifecycle hook.
     * Supported names: "session_start", "before_compaction", "after_compaction",
     * "before_prompt_build"
     */
    on(event: string, handler: (...args: unknown[]) => unknown, opts?: {
        priority?: number;
    }): void;
    registerContextEngine(id: string, factory: () => ContextEngineInstance): void;
    registerCommand?(cmd: {
        name: string;
        description: string;
        acceptsArgs?: boolean;
        requireAuth?: boolean;
        handler: (ctx: CommandContext) => {
            text: string;
        } | Promise<{
            text: string;
        }>;
    }): void;
    registerCli?(factory: (ctx: {
        program: unknown;
    }) => void, meta: {
        commands: string[];
    }): void;
    /**
     * Register an agent tool (OpenClaw native registerTool) — see
     * refs/platforms/openclaw/docs/plugins/building-plugins.md:116. Optional in
     * the type so we degrade silently on legacy hosts that pre-date this API.
     */
    registerTool?(tool: OpenClawToolDef, opts?: {
        optional?: boolean;
    }): void;
    logger?: {
        info: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
        debug?: (...args: unknown[]) => void;
        warn?: (...args: unknown[]) => void;
    };
}
/** Context engine instance returned by the factory. */
interface ContextEngineInstance {
    info: {
        id: string;
        name: string;
        ownsCompaction: boolean;
    };
    ingest(data: unknown): Promise<{
        ingested: boolean;
    }>;
    assemble(ctx: {
        messages: unknown[];
    }): Promise<{
        messages: unknown[];
        estimatedTokens: number;
    }>;
    compact(): Promise<{
        ok: boolean;
        compacted: boolean;
    }>;
}
/**
 * OpenClaw plugin definition. The object form provides declarative metadata
 * (id, name, configSchema) that OpenClaw can read without executing code.
 * register() is called once per agent session with a fresh api object.
 * Each call creates isolated closures (db, sessionId, hooks) — no shared state.
 */
declare const _default: {
    id: string;
    name: string;
    configSchema: {
        type: "object";
        properties: {
            enabled: {
                type: "boolean";
                default: boolean;
                description: string;
            };
        };
        additionalProperties: boolean;
    };
    register(api: OpenClawPluginApi): void;
};
export default _default;
