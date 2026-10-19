// server.ts — entry point of the universal-format MCP stdio server. Bundled by
// `pnpm run build:universal-format-mcp` into plugins/universal-format/mcp/server.mjs.
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs -> stderr.
//   format_pre (PreToolUse Write|Edit) — the one tool: every supported language formatted BEFORE the
//   write and handed back via updatedInput (prettier languages in-process, kotlin/python/go/rust
//   through their CLI on stdin). See handlers.ts.
import process from "node:process";
import readline from "node:readline";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatPre } from "./handlers.js";

const SERVER_NAME = "universal-format-hooks"; // keep aligned with the .mcp.json key

// plugin.json ships next to mcp/ in every install (it is the plugin manifest), so the version is
// read from it at startup rather than baked into the bundle: a release bump needs no rebuild.
// "0.0.0" only if the manifest is missing; runtime-detect.test.mjs pins the real value.
function readPluginVersion(): string {
  try {
    return String(JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8")).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}
const SERVER_INFO = { name: SERVER_NAME, version: readPluginVersion() };
const DEFAULT_PROTOCOL = "2025-11-25"; // only used if the client omits protocolVersion

// ---- public surface of the built artifact, imported by the test suites ----
export { BUNDLED_PRETTIER_VERSION, bundledPluginsFor, formatInProcess, hasPrettierProjectConfig, resolveConfigPlugins, shouldOverridePrintWidth } from "./prettier.js";
export { EXT_MAP, PRETTIER_LANGS, REGISTRY, cargoEdition, selectFormatter } from "./registry.js";
export { buildInvocation, findNativeConfig, matchGlob, parseEditorconfig, resolveEditorconfig } from "./editorconfig.js";
export { applyEdit, formatPre, isExcludedPath, resolveBase, shrinkSwap } from "./handlers.js";

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

// Which JS runtime this process is under — `process.versions.bun` is bun's version string under
// bun, undefined under node; reading it introduces no `Bun` token, so the node-target bundle
// stays free of `Bun.`/`bun:` and needs no @types/bun.
function detectRuntime(): "bun" | "node" {
  return process.versions.bun ? "bun" : "node";
}

// ---- MCP scaffold + startup ----

function startServer(): void {
  const TOOLS: ToolDef[] = [
    {
      name: "format_pre",
      description:
        "PreToolUse Write|Edit: format the file content before the write (updatedInput) — prettier languages (jsts/json/yaml/markdown/css/scss/less/html/vue/graphql/shell/java/php) in-process with the bundled prettier, kotlin/python/go/rust through the first CLI formatter on PATH, fed on stdin.",
      inputSchema: { type: "object", additionalProperties: true },
      handler: formatPre,
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

  // Claude Code stops a stdio MCP server with SIGINT (SIGTERM after 100 ms, SIGKILL after 400 ms) on
  // every platform but Windows, where it closes stdin instead. Node writes its V8 compile cache
  // (NODE_COMPILE_CACHE, set by bin/mjs-launch.sh) only on a normal exit, so both signals must end in
  // process.exit(0) rather than death by signal. Armed before the startup line below, which the
  // signal test waits for.
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

  process.stderr.write(`[${SERVER_NAME}] running under ${detectRuntime()} (v${SERVER_INFO.version})\n`);

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
    Promise.resolve(handle(msg)).catch((e: any) => {
      process.stderr.write(`[${SERVER_NAME}] handler crash: ${e?.stack ?? e}\n`);
      // A request (has an id) must always get a response, or the client hangs waiting for one
      // that will never come; a notification (no id) correctly gets none, per the default case.
      if (msg?.id !== undefined) fail(msg.id, -32603, `internal error: ${e?.message ?? e}`);
    });
  });
  rl.on("close", () => process.exit(0));
}

if (isMainModule()) startServer();
