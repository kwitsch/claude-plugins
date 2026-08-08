// server.ts — entry point of the universal-format MCP stdio server. Bundled by
// `pnpm run build:universal-format-mcp` into plugins/universal-format/mcp/server.mjs.
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs -> stderr.
//   format_pre  (PreToolUse Write|Edit)  — prettier languages, in-process, updatedInput
//   format_post (PostToolUse Write|Edit) — shell/java/kotlin/python/go/php via each tool's CLI
import process from "node:process";
import readline from "node:readline";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatPost, formatPre } from "./handlers.js";

const SERVER_NAME = "universal-format-hooks"; // keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.10.0" }; // hand-paired with plugin.json
const DEFAULT_PROTOCOL = "2025-11-25"; // only used if the client omits protocolVersion

// ---- public surface of the built artifact: exactly 17 names, imported by the test suites ----
export { BUNDLED_PRETTIER_VERSION, formatInProcess, hasPrettierProjectConfig, resolveConfigPlugins, shouldOverridePrintWidth } from "./prettier.js";
export { EXT_MAP, PRETTIER_LANGS, REGISTRY } from "./registry.js";
export { buildInvocation, findNativeConfig, matchGlob, parseEditorconfig, resolveEditorconfig } from "./editorconfig.js";
export { applyEdit, formatPost, formatPre, isExcludedPath } from "./handlers.js";

type ToolDef = {
  name: string;
  description: string;
  inputSchema: { type: string; additionalProperties: boolean };
  handler: (args: any) => Promise<HookResult>;
};

// True only when this file is the process entry point (MCP spawn / `node server.mjs`), false when
// imported by a unit test — so importing never starts the stdin loop.
function isMainModule(): boolean {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// ---- MCP scaffold + startup ----

function startServer(): void {
  const TOOLS: ToolDef[] = [
    {
      name: "format_pre",
      description: "PreToolUse Write|Edit: format prettier-language files (jsts/json/yaml/markdown/css/scss) in-process before the write (updatedInput) with the prettier bundled into this server.",
      inputSchema: { type: "object", additionalProperties: true },
      handler: formatPre,
    },
    {
      name: "format_post",
      description: "PostToolUse Write|Edit: format the just-written file with the language's CLI formatter (shell/java/kotlin/python/go/php); prettier languages belong to format_pre.",
      inputSchema: { type: "object", additionalProperties: true },
      handler: formatPost,
    },
  ];
  const findTool = (name: string) => TOOLS.find((t) => t.name === name);
  const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
  const ok = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
  const fail = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

  const handle = async (msg: any) => {
    const { id, method, params } = msg;
    switch (method) {
      case "initialize":
        return ok(id, { protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      case "notifications/initialized":
      case "notifications/cancelled":
        return;
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case "tools/call": {
        const tool = findTool(params?.name);
        if (!tool) return fail(id, -32602, `unknown tool: ${params?.name}`);
        if (process.env.MCP_HOOK_DEBUG) process.stderr.write(`[${SERVER_NAME}] tools/call ${params?.name}\n`);
        let result;
        try {
          result = await tool.handler(params?.arguments ?? {});
        } catch (e) {
          const err: any = e;
          return fail(id, -32603, `tool error: ${err?.message ?? err}`);
        }
        return ok(id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
      }
      default:
        if (id === undefined) return;
        return fail(id, -32601, `method not found: ${method}`);
    }
  };

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stderr.write(`[${SERVER_NAME}] non-JSON line ignored\n`);
      return;
    }
    Promise.resolve(handle(msg)).catch((e: any) => process.stderr.write(`[${SERVER_NAME}] handler crash: ${e?.stack ?? e}\n`));
  });
  rl.on("close", () => process.exit(0));
}

if (isMainModule()) startServer();
