// embed.mjs — in-process adapter over the VENDORED context-mode server bundle.
// Replaces the stdio-child proxy: imports server.bundle.mjs with
// CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS=1 (suppresses its auto-run main) and exposes the
// REGISTERED_CTX_TOOLS handlers directly. Preserves the proxy's Upstream contract.
import { fileURLToPath } from "node:url";
import { contextModeEnv } from "./context-mode-env.mjs";

const BUNDLE = fileURLToPath(new URL("../bin/context-mode/server.bundle.mjs", import.meta.url));

export class Upstream {
  constructor() { this.tools = []; this.byName = new Map(); this.alive = false; }

  async start() {
    // Apply context-mode storage-root env BEFORE import (the bundle reads env at load).
    const env = contextModeEnv();
    if (env.CONTEXT_MODE_DIR && !process.env.CONTEXT_MODE_DIR) process.env.CONTEXT_MODE_DIR = env.CONTEXT_MODE_DIR;
    process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = "1";
    let mod;
    try { mod = await import(BUNDLE); }
    catch (e) { process.stderr.write(`[cave-context] embedded context-mode import failed: ${e?.message ?? e}\n`); this.alive = false; return []; }
    const reg = mod.REGISTERED_CTX_TOOLS ?? [];
    this.byName = new Map(reg.map((t) => [t.name, t.handler]));
    this.tools = reg.map((t) => ({
      name: t.name,
      description: t.config?.description ?? t.name,
      inputSchema: t.config?.inputSchema ?? { type: "object", additionalProperties: true },
    }));
    this.alive = true;
    return this.tools;
  }

  async callTool(name, args) {
    const handler = this.byName.get(name);
    if (!handler) throw new Error(`unknown tool: ${name}`);
    return handler(args ?? {}); // returns the MCP { content: [...] } envelope
  }

  stop() { this.alive = false; }
}
