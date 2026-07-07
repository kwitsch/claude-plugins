#!/usr/bin/env node
// mcp/server.mjs — universal-format plugin: PostToolUse Write|Edit auto-formatter.
// Self-contained, zero-dependency MCP stdio server (Node built-ins only).
// Invoked directly as the .mcp.json command (#!/usr/bin/env node; node-only, no wrapper).
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs -> stderr.
//
// format_file flow (every failure path returns {} silently — fail open):
//   guard tool_response.success !== false -> ext in registry -> path inside cwd and not
//   under node_modules/vendor/.git -> file exists -> auto_format not literal false ->
//   first formatter of the language chain on PATH (probes cached) -> resolveInvocation
//   -> spawnSync (cwd = project cwd, 30s timeout, stdio ignored) -> before/after content
//   diff (NEVER exit codes) -> changed: additionalContext one-liner; unchanged: {}.
import process from "node:process";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  existsSync,
  readFileSync,
  realpathSync,
  constants as fsConstants,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_NAME = "universal-format-hooks"; // keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // only used if client omits protocolVersion
const SPAWN_TIMEOUT_MS = 30000; // inner formatter timeout; hook-level timeout:60 is the backstop

/**
 * @typedef {{ name: string, strategy: string, base: string[], nativeConfig?: Array<string | {file: string, section: string}> }} FormatTool
 * @typedef {{ chain: FormatTool[] }} LangEntry
 */

// Lowercased file extension (incl. leading dot) -> language key.
/** @type {Record<string, string>} */
const EXT_MAP = {
  ".sh": "shell",
  ".bash": "shell",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".js": "jsts",
  ".jsx": "jsts",
  ".mjs": "jsts",
  ".cjs": "jsts",
  ".ts": "jsts",
  ".tsx": "jsts",
  ".mts": "jsts",
  ".cts": "jsts",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
};

// Formatter registry (research-verified). chain = first tool on PATH wins.
// strategy "native"/"fixed" -> always run bare (base args); "mapped" -> .editorconfig
// flag mapping applied only when no tool-native config governs (added in Task 3).
// base = argv BEFORE the target file (the file is always appended last).
// clang-format base carries --fallback-style=Google: it is ignored when a real
// .clang-format is found, so the same base is correct both with and without one.
/** @type {Record<string, LangEntry>} */
export const REGISTRY = {
  shell: { chain: [{ name: "shfmt", strategy: "native", base: ["-w"] }] },
  java: {
    chain: [
      {
        name: "google-java-format",
        strategy: "mapped",
        nativeConfig: [],
        base: ["--replace"],
      },
      {
        name: "clang-format",
        strategy: "mapped",
        nativeConfig: [".clang-format", "_clang-format"],
        base: ["-i", "--style=file", "--fallback-style=Google"],
      },
    ],
  },
  kotlin: {
    chain: [
      {
        name: "ktlint",
        strategy: "native",
        base: ["--format", "--log-level=none"],
      },
      {
        name: "ktfmt",
        strategy: "native",
        base: ["--enable-editorconfig", "--quiet"],
      },
    ],
  },
  jsts: {
    chain: [
      {
        name: "prettier",
        strategy: "native",
        base: ["--write", "--log-level", "silent"],
      },
      {
        name: "biome",
        strategy: "mapped",
        nativeConfig: ["biome.json", "biome.jsonc"],
        base: ["format", "--write", "--log-level=none"],
      },
    ],
  },
  python: {
    chain: [
      {
        name: "ruff",
        strategy: "mapped",
        nativeConfig: [
          ".ruff.toml",
          "ruff.toml",
          { file: "pyproject.toml", section: "tool.ruff" },
        ],
        base: ["format", "--quiet"],
      },
      {
        name: "black",
        strategy: "mapped",
        nativeConfig: [{ file: "pyproject.toml", section: "tool.black" }],
        base: ["--quiet"],
      },
    ],
  },
  go: {
    chain: [
      { name: "goimports", strategy: "fixed", base: ["-w"] },
      { name: "gofmt", strategy: "fixed", base: ["-w"] },
    ],
  },
};

// PATH probe cache (server-lifetime): tool name -> boolean on PATH.
/** @type {Map<string, boolean>} */
const probeCache = new Map();
/** @param {string} tool @returns {boolean} */
function onPath(tool) {
  const cached = probeCache.get(tool);
  if (cached !== undefined) return cached;
  let found = false;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    try {
      accessSync(path.join(dir, tool), fsConstants.X_OK);
      found = true;
      break;
    } catch {
      /* keep looking */
    }
  }
  probeCache.set(tool, found);
  return found;
}

// auto_format toggle: ONLY literal false disables. Scope precedence local>project>user;
// the first scope that DEFINES the key wins; no definition anywhere -> enabled (fail open).
/** @param {string} cwd @returns {boolean} */
function isAutoFormatEnabled(cwd) {
  const scopes = [
    path.join(cwd, ".claude", "settings.local.json"),
    path.join(cwd, ".claude", "settings.json"),
    path.join(homedir(), ".claude", "settings.json"),
  ];
  for (const file of scopes) {
    let json;
    try {
      json = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const configs = json?.pluginConfigs ?? {};
    const key = Object.keys(configs).find((k) =>
      k.startsWith("universal-format@"),
    );
    const options = key ? configs[key]?.options : undefined;
    if (
      options &&
      Object.prototype.hasOwnProperty.call(options, "auto_format")
    ) {
      return options.auto_format !== false;
    }
  }
  return true;
}

// Determine the formatter invocation. TASK-2 FORM: always bare (native/fixed and
// bare-mapped are identical here). Task 3 replaces this body with the .editorconfig
// mapping + hard-conflict skip; the handler below is written once and never touched.
/** @param {FormatTool} tool @param {string} _file @param {string} _cwd @returns {{argv: string[]} | {skip: true}} */
// eslint-disable-next-line no-unused-vars -- file/cwd are the Task 3 .editorconfig seam
function resolveInvocation(tool, _file, _cwd) {
  return { argv: tool.base.slice() };
}

// The format_file tool handler. Returns {} on every guard failure / error (fail open).
/** @param {PostToolUseHookInput} args @returns {HookResult} */
function formatFileHandler(args) {
  try {
    if (args?.tool_response?.success === false) return {};
    const cwd = typeof args?.cwd === "string" ? args.cwd : "";
    const fp = args?.tool_input?.file_path;
    if (!cwd || typeof fp !== "string" || !fp) return {};

    const resolved = path.resolve(cwd, fp);
    if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) return {};
    const rel = path.relative(cwd, resolved);
    if (
      rel
        .split(path.sep)
        .some(
          (/** @type {string} */ s) =>
            s === "node_modules" || s === "vendor" || s === ".git",
        )
    )
      return {};

    const lang = EXT_MAP[path.extname(resolved).toLowerCase()];
    if (!lang) return {};
    if (!existsSync(resolved)) return {};
    if (!isAutoFormatEnabled(cwd)) return {};

    const tool = REGISTRY[lang].chain.find((t) => onPath(t.name));
    if (!tool) return {};

    const inv = resolveInvocation(tool, resolved, cwd);
    if ("skip" in inv) return {};

    const before = readFileSync(resolved);
    try {
      spawnSync(tool.name, [...inv.argv, resolved], {
        cwd,
        timeout: SPAWN_TIMEOUT_MS,
        stdio: "ignore",
      });
    } catch {
      /* spawn failure is a silent no-op */
    }
    const after = readFileSync(resolved);
    if (before.equals(after)) return {};

    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `universal-format: ${tool.name} reformatted ${rel}; re-read it before further string-based edits.`,
      },
    };
  } catch {
    return {};
  }
}

// True only when this file is the process entry point (MCP spawn / `node server.mjs`),
// false when imported by a unit test — so importing never starts the stdin loop.
function isMainModule() {
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

function startServer() {
  const TOOLS = [
    {
      name: "format_file",
      description:
        "PostToolUse Write|Edit auto-formatter: formats the just-written file with the language's standard formatter when installed. Returns additionalContext when the file changed, {} otherwise.",
      inputSchema: { type: "object", additionalProperties: true },
      handler: formatFileHandler,
    },
  ];
  const findTool = (/** @type {any} */ name) =>
    TOOLS.find((t) => t.name === name);
  const send = (/** @type {any} */ msg) =>
    process.stdout.write(JSON.stringify(msg) + "\n");
  const ok = (/** @type {any} */ id, /** @type {any} */ result) =>
    send({ jsonrpc: "2.0", id, result });
  const fail = (
    /** @type {any} */ id,
    /** @type {any} */ code,
    /** @type {any} */ message,
  ) => send({ jsonrpc: "2.0", id, error: { code, message } });

  const handle = (/** @type {any} */ msg) => {
    const { id, method, params } = msg;
    switch (method) {
      case "initialize":
        return ok(id, {
          protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      case "notifications/initialized":
      case "notifications/cancelled":
        return;
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
      case "tools/call": {
        const tool = findTool(params?.name);
        if (!tool) return fail(id, -32602, `unknown tool: ${params?.name}`);
        if (process.env.MCP_HOOK_DEBUG) {
          process.stderr.write(
            `[${SERVER_NAME}] tools/call ${params?.name} args=${JSON.stringify(params?.arguments)}\n`,
          );
        }
        let result;
        try {
          result = tool.handler(params?.arguments ?? {});
        } catch (e) {
          const err = /** @type {any} */ (e);
          return fail(id, -32603, `tool error: ${err?.message ?? err}`);
        }
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        });
      }
      default:
        if (id === undefined) return;
        return fail(id, -32601, `method not found: ${method}`);
    }
  };

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (/** @type {any} */ line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stderr.write(`[${SERVER_NAME}] non-JSON line ignored\n`);
      return;
    }
    try {
      handle(msg);
    } catch (e) {
      const err = /** @type {any} */ (e);
      process.stderr.write(
        `[${SERVER_NAME}] handler crash: ${err?.stack ?? err}\n`,
      );
    }
  });
  rl.on("close", () => process.exit(0));
}

if (isMainModule()) startServer();
