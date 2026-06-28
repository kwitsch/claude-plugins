// embed.mjs — in-process adapter over the VENDORED context-mode server bundle.
// Replaces the stdio-child proxy: imports server.bundle.mjs with
// CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS=1 (suppresses its auto-run main) and exposes the
// REGISTERED_CTX_TOOLS handlers directly. Preserves the proxy's Upstream contract.
import { fileURLToPath } from "node:url";
import { contextModeEnv } from "./context-mode-env.mjs";

const BUNDLE = fileURLToPath(new URL("../bin/context-mode/server.bundle.mjs", import.meta.url));

export class Upstream {
  constructor() {
    /** @type {any[]} */
    this.tools = [];
    /** @type {Map<string, any>} */
    this.byName = new Map();
    /** @type {boolean} */
    this.alive = false;
  }

  /** @returns {Promise<any[]>} */
  async start() {
    // Apply context-mode storage-root env BEFORE import (the bundle reads env at load).
    const env = contextModeEnv();
    if (env.CONTEXT_MODE_DIR && !process.env.CONTEXT_MODE_DIR) process.env.CONTEXT_MODE_DIR = env.CONTEXT_MODE_DIR;
    process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = "1";
    let mod;
    try { mod = await import(BUNDLE); }
    catch (e) { process.stderr.write(`[cave-context] embedded context-mode import failed: ${(/** @type {any} */ (e))?.message ?? e}\n`); this.alive = false; return []; }
    const reg = mod.REGISTERED_CTX_TOOLS ?? [];
    // callTool dispatches to each tool's registered Zod-validated handler.
    this.byName = new Map(reg.map(/** @param {any} t */ (t) => [t.name, t.handler]));
    // tools/list inputSchema MUST be a JSON Schema (`type: "object"`), NOT the raw Zod
    // object context-mode registers tools with — Claude Code Zod-validates each entry's
    // inputSchema.type and drops the whole server ("tools fetch failed") otherwise.
    this.tools = await listToolSchemas(mod, reg);
    this.alive = true;
    return this.tools;
  }

  /**
   * @param {string} name
   * @param {any} [args]
   * @returns {Promise<any>}
   */
  async callTool(name, args) {
    const handler = this.byName.get(name);
    if (!handler) throw new Error(`unknown tool: ${name}`);
    return handler(args ?? {}); // returns the MCP { content: [...] } envelope
  }

  /** @returns {void} */
  stop() { this.alive = false; }
}

// A tool's inputSchema MUST be a JSON Schema object. Anything else (a raw Zod object,
// undefined, a non-object) is replaced with a permissive object schema so an invalid
// schema can never reach the wire and break the client's tools/list validation.
const PERMISSIVE_SCHEMA = { type: "object", additionalProperties: true };
/**
 * @param {any[]} tools
 * @returns {any[]}
 */
function sanitizeTools(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? t.name,
    inputSchema: t.inputSchema?.type === "object" ? t.inputSchema : PERMISSIVE_SCHEMA,
  }));
}

// Build the tools/list payload with JSON-Schema inputSchemas.
// Primary path: invoke the embedded MCP SDK server's own "tools/list" request handler —
// it converts each tool's Zod schema to JSON Schema (type:"object", properties, enums, …),
// identical to what the real stdio context-mode server emits. There is no public accessor
// for this conversion, so we reach the SDK-internal request-handler map; the vendored bundle
// is sha256-pinned, and sanitizeTools() + the server.test.mjs schema regression test guard
// the reliance. Fallback (SDK shape changed / handler threw): tool names with permissive
// schemas — degraded param hints, but never a connection-breaking invalid schema.
/**
 * @param {any} mod
 * @param {any[]} reg
 * @returns {Promise<any[]>}
 */
async function listToolSchemas(mod, reg) {
  try {
    const handler = mod.server?.server?._requestHandlers?.get?.("tools/list");
    if (typeof handler === "function") {
      const res = await handler(
        { method: "tools/list", params: {} },
        { signal: new AbortController().signal, requestId: 0, sendNotification: async () => {}, sendRequest: async () => {} },
      );
      const tools = Array.isArray(res?.tools) ? res.tools : [];
      if (tools.length) return sanitizeTools(tools);
    }
  } catch (e) {
    process.stderr.write(`[cave-context] SDK tools/list conversion failed, using permissive schemas: ${(/** @type {any} */ (e))?.message ?? e}\n`);
  }
  return sanitizeTools(reg.map((t) => ({ name: t.name, description: t.config?.description ?? t.name, inputSchema: t.config?.inputSchema })));
}
