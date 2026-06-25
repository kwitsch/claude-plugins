/**
 * OpenClaw MCP tool registry.
 *
 * Catalogs the 11 ctx_* tools that OpenClaw plugin must register via
 * api.registerTool(...) so the routing block (which nudges agents toward
 * ctx_execute, ctx_search, etc.) actually has tools to call. Without this,
 * Phase 7 audit (v1.0.107-adapter-openclaw.json) flagged severity=CRITICAL —
 * routing-block premise is broken when the named tools don't exist.
 *
 * Pattern mirrors the swarmvault MCP plugin
 * (refs/plugin-examples/openclaw/swarmvault/packages/engine/src/mcp.ts:46-51):
 *   server.registerTool(name, { description, inputSchema }, handler)
 *
 * OpenClaw signature is slightly different — see building-plugins.md:116
 *   api.registerTool({ name, description, parameters: TypeBox, execute(id, params) })
 *
 * Tool handlers are intentionally thin shims that delegate to the bundled CLI
 * (cli.bundle.mjs) — same fall-through pattern already used by ctx-doctor and
 * ctx-upgrade slash commands. This keeps the plugin's blast radius minimal:
 * we don't re-export the entire MCP server stack inside OpenClaw's process.
 *
 * The 11 tools mirror src/server.ts registerTool calls (lines 897, 1226, 1371,
 * 1497, 2034, 2256, 2440, 2501, 2592, 2712, 2808).
 */
/** Minimal JSON-schema-like parameter spec accepted by OpenClaw registerTool. */
export interface OpenClawToolParameters {
    type: "object";
    properties: Record<string, {
        type: string;
        description?: string;
    }>;
    required?: string[];
    additionalProperties?: boolean;
}
/** Tool definition shape returned to OpenClaw via api.registerTool. */
export interface OpenClawToolDef {
    name: string;
    description: string;
    parameters: OpenClawToolParameters;
    execute: (id: string, params: Record<string, unknown>) => Promise<{
        content: Array<{
            type: "text";
            text: string;
        }>;
    }>;
}
/**
 * The 11 ctx_* tool definitions registered into OpenClaw via api.registerTool.
 * Names + descriptions mirror src/server.ts registerTool blocks 1:1 so prompts
 * referencing them (routing block, AGENTS.md) resolve to real callable tools.
 */
export declare const OPENCLAW_TOOL_DEFS: readonly OpenClawToolDef[];
/** Stable list of tool names — used by tests and manifest validation. */
export declare const OPENCLAW_TOOL_NAMES: readonly string[];
