#!/usr/bin/env node
// mcp/server.mjs — universal-lint plugin: PostToolUse Write|Edit lint-only checker.
// Self-contained, zero-dependency MCP stdio server (Node built-ins only).
// Invoked directly as the .mcp.json command (#!/usr/bin/env node; node-only, no wrapper).
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs -> stderr.
//
// lint_file flow (every failure path returns {} silently -- fail open):
//   guard tool_response.success !== false -> ext in registry -> path inside cwd and not
//   under node_modules/vendor/.git -> file exists -> some chain tool on PATH (probes
//   cached) -> auto_lint not literal false -> first chain tool on PATH wins (no
//   per-file skip -- no style mapping exists for linters) -> spawnSync (cwd = project
//   cwd, 30s timeout, stdout+stderr captured) -> classify (exit code for 5 tools;
//   checkstyle by stripped-output, since its exit code counts only ERROR-severity
//   violations and the bundled default ruleset runs at `warning`) -> issues found:
//   truncated additionalContext; clean/skip/no candidate: {}.
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

const SERVER_NAME = "universal-lint-hooks"; // keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // only used if client omits protocolVersion
const SPAWN_TIMEOUT_MS = 30000; // inner linter timeout; hook-level timeout:60 is the backstop
const MAX_CONTEXT_CHARS = 4000; // cap on the additionalContext findings text
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // spawnSync's 1MB default truncates a noisy linter's output as ENOBUFS

/**
 * @typedef {{ name: string, args: string[], targetsDir?: boolean, classify?: "output", needsCheckstyleConfig?: boolean, npmSpec?: string }} LintTool
 * @typedef {{ chain: LintTool[] }} LangEntry
 */

// Lowercased file extension (incl. leading dot) -> language key. Identical set to
// the universal-format plugin's EXT_MAP (same six languages).
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

// Linter registry. chain = first tool on PATH wins. Every entry runs check-only --
// never --fix/--format/--write. Go entries target the edited file's DIRECTORY
// (package), not the bare file: go vet/golangci-lint operate on packages, and a
// lone file referencing sibling-file symbols would otherwise fail with spurious
// "undefined: X" compile-context errors. checkstyle is classified by stdout, not
// exit code (see classifyCheckstyleOutput) -- its exit code counts only
// ERROR-severity violations, and the bundled default ruleset runs at `warning`.
/** @type {Record<string, LangEntry>} */
export const REGISTRY = {
  shell: { chain: [{ name: "shellcheck", args: [] }] },
  java: {
    chain: [
      {
        name: "checkstyle",
        args: [],
        classify: "output",
        needsCheckstyleConfig: true,
      },
    ],
  },
  kotlin: { chain: [{ name: "ktlint", args: [] }] },
  jsts: { chain: [{ name: "eslint", args: [], npmSpec: "eslint" }] },
  python: { chain: [{ name: "ruff", args: ["check"] }] },
  go: {
    chain: [
      { name: "golangci-lint", args: ["run"], targetsDir: true },
      { name: "go", args: ["vet"], targetsDir: true },
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

// A tool is available directly on PATH, or indirectly via `npx <npmSpec>` when
// the registry declares npmSpec (a verified-official npm package only -- see
// the REGISTRY comments) and npx itself is on PATH. Booleans are passed in
// rather than calling onPath() internally so this stays a pure, unit-testable
// function.
/** @param {LintTool} tool @param {boolean} toolOnPath @param {boolean} npxOnPath @returns {boolean} */
export function isToolAvailable(tool, toolOnPath, npxOnPath) {
  return toolOnPath || (!!tool.npmSpec && npxOnPath);
}

const RTK_PROBE_TIMEOUT_MS = 5000; // lightweight metadata probe, not a real lint run

// Parse `rtk rewrite <tool> <args...> "__RTK_PROBE__"` stdout into the rtk verb
// tokens to run instead of the bare tool (e.g. "rtk lint __RTK_PROBE__" -> ["lint"],
// "rtk go vet __RTK_PROBE__" -> ["go", "vet"]), or null when rtk has no filtered
// equivalent for this tool (checkstyle, ktlint currently answer empty). Keys off
// the placeholder token position, not the exit code: rtk rewrite's own --help
// claims exit 0/1 for supported/unsupported, but the observed behavior (0.43.0)
// is 3/1 -- do not "fix" this to check `=== 0`.
/** @param {string | undefined} stdout @returns {string[] | null} */
export function parseRtkPrefix(stdout) {
  const tokens = String(stdout ?? "")
    .trim()
    .split(/\s+/);
  const probeIdx = tokens.indexOf("__RTK_PROBE__");
  if (tokens[0] !== "rtk" || probeIdx < 2) return null;
  return tokens.slice(1, probeIdx);
}

// rtk verb-prefix cache (server-lifetime): tool.name -> string[] (supported) | null.
/** @type {Map<string, string[] | null>} */
const rtkPrefixCache = new Map();

// Probe rtk once per tool name: does rtk have a filtered equivalent for this tool
// + its static registry args? A placeholder final token avoids argv-splitting
// hazards from a real file path containing spaces (rtk rewrite echoes back a
// plain string, not a shell-quoted one).
/** @param {LintTool} tool @returns {string[] | null} */
function getRtkPrefix(tool) {
  const cached = rtkPrefixCache.get(tool.name);
  if (cached !== undefined) return cached;
  let prefix = null;
  try {
    const probe = spawnSync(
      "rtk",
      ["rewrite", tool.name, ...tool.args, "__RTK_PROBE__"],
      { timeout: RTK_PROBE_TIMEOUT_MS, encoding: "utf8" },
    );
    prefix = parseRtkPrefix(probe.stdout);
  } catch {
    /* probe failure -> no rtk support for this tool */
  }
  rtkPrefixCache.set(tool.name, prefix);
  return prefix;
}

// auto_lint toggle: ONLY literal false disables. Scope precedence local>project>user;
// the first scope that DEFINES the key wins; no definition anywhere -> enabled (fail open).
/** @param {string} cwd @returns {boolean} */
function isAutoLintEnabled(cwd) {
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
      k.startsWith("universal-lint@"),
    );
    const options = key ? configs[key]?.options : undefined;
    if (options && Object.prototype.hasOwnProperty.call(options, "auto_lint")) {
      return options.auto_lint !== false;
    }
  }
  return true;
}

// Walk from the file's dir up to cwd (inclusive); return the first existing
// checkstyle config path, or null. Existence-only (no section parsing needed --
// unlike a formatter, a linter doesn't need to reproduce exact style output, so
// there is no "does this section apply to this file" question to answer).
/** @param {string} fileDir @param {string} cwd @returns {string | null} */
export function resolveCheckstyleConfig(fileDir, cwd) {
  const candidates = [
    "checkstyle.xml",
    ".checkstyle.xml",
    path.join("config", "checkstyle", "checkstyle.xml"),
  ];
  let dir = fileDir;
  for (;;) {
    for (const rel of candidates) {
      const p = path.join(dir, rel);
      if (existsSync(p)) return p;
    }
    if (dir === cwd) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root safety
    dir = parent;
  }
  return null;
}

// Build the argv for a chain tool: fixed bare args, an optional -c <config> for
// checkstyle, then the target (the file, or its directory for targetsDir tools) last.
/** @param {LintTool} tool @param {string} resolvedFile @param {string} cwd @returns {string[]} */
export function buildArgv(tool, resolvedFile, cwd) {
  const dir = path.dirname(resolvedFile);
  const argv = tool.args.slice();
  if (tool.needsCheckstyleConfig) {
    argv.push("-c", resolveCheckstyleConfig(dir, cwd) ?? "/google_checks.xml");
  }
  argv.push(tool.targetsDir ? dir : resolvedFile);
  return argv;
}

// Classify a lint-tool exit code into "clean" | "issues" | "skip" (crashed / usage
// error / config problem -- not a real lint finding). Per-tool contracts verified
// against each tool's official docs (see the design doc's research table). Never
// consulted for checkstyle -- see classifyCheckstyleOutput.
/** @param {string} toolName @param {number | null} status @returns {"clean" | "issues" | "skip"} */
export function classifyExit(toolName, status) {
  if (status === null) return "skip"; // killed by signal (timeout) or spawn error
  switch (toolName) {
    case "shellcheck": // 0 clean, 1 issues, 2/3/4 file-not-found/bad-invocation/bad-options
    case "ktlint": // 0 clean, 1 issues (lint-only mode; --format's quirk doesn't apply here)
    case "eslint": // 0 clean, 1 issues, 2 config/internal error
    case "ruff": // 0 clean, 1 issues, 2 abnormal termination
    case "golangci-lint": // 0 clean, 1 issues, 2-7 warning-in-test/failure/timeout/no-go-files/no-config/error-logged
      if (status === 0) return "clean";
      if (status === 1) return "issues";
      return "skip";
    case "go": // go vet: 0 clean, non-zero = "problem reported OR erroneous invocation" (Go's
      // own docs don't separate the two); accepted -- see design doc Risks.
      return status === 0 ? "clean" : "issues";
    default:
      return "skip";
  }
}

// checkstyle prints exactly "Starting audit..." first and "Audit done." last,
// regardless of violation count or severity -- confirmed against the Main CLI
// docs. A run that didn't reach "Audit done." didn't complete normally (bad
// config, exception, kill) -> skip. Otherwise strip both boilerplate lines; what
// remains is the actual violation text (issues) or nothing (clean).
/** @param {string} stdout @returns {{status: "clean" | "issues" | "skip", text: string}} */
export function classifyCheckstyleOutput(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/);
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && lines[lastIdx].trim() === "") lastIdx--;
  if (lastIdx < 0 || lines[lastIdx].trim() !== "Audit done.")
    return { status: "skip", text: "" };
  let firstIdx = 0;
  while (firstIdx < lines.length && lines[firstIdx].trim() === "") firstIdx++;
  const skipFirst =
    firstIdx < lines.length && lines[firstIdx].trim() === "Starting audit...";
  const body = lines
    .slice(skipFirst ? firstIdx + 1 : firstIdx, lastIdx)
    .join("\n")
    .trim();
  return body
    ? { status: "issues", text: body }
    : { status: "clean", text: "" };
}

// Trim, collapse runs of 3+ blank lines to one, and cap at MAX_CONTEXT_CHARS.
/** @param {string} text @returns {string} */
export function truncate(text) {
  const collapsed = text.replace(/\n{3,}/g, "\n\n").trim();
  if (collapsed.length <= MAX_CONTEXT_CHARS) return collapsed;
  return collapsed.slice(0, MAX_CONTEXT_CHARS) + "\n… (truncated)";
}

// The lint_file tool handler. Returns {} on every guard failure / clean / skip (fail open).
/** @param {PostToolUseHookInput} args @returns {HookResult} */
function lintFileHandler(args) {
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

    // Cached O(1) PATH probe before the uncached settings-file reads.
    const tool = REGISTRY[lang].chain.find((t) =>
      isToolAvailable(t, onPath(t.name), onPath("npx")),
    );
    if (!tool) return {};
    if (!isAutoLintEnabled(cwd)) return {};

    const argv = buildArgv(tool, resolved, cwd);
    const spawnOpts = {
      cwd,
      timeout: SPAWN_TIMEOUT_MS,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: MAX_BUFFER_BYTES,
    };
    const npmSpec = onPath(tool.name) ? undefined : tool.npmSpec;
    let result;
    if (npmSpec) {
      result = spawnSync("npx", ["--yes", npmSpec, ...argv], spawnOpts);
    } else {
      const rtkPrefix = onPath("rtk") ? getRtkPrefix(tool) : null;
      if (rtkPrefix) {
        const rtkResult = spawnSync(
          "rtk",
          [...rtkPrefix, ...argv.slice(tool.args.length)],
          spawnOpts,
        );
        if (!rtkResult.error && !rtkResult.signal) result = rtkResult;
      }
      if (!result) result = spawnSync(tool.name, argv, spawnOpts);
    }
    if (result.error || result.signal) return {};

    const target = tool.targetsDir
      ? path.relative(cwd, path.dirname(resolved)) || "."
      : rel;
    let verdict, text;
    if (tool.classify === "output") {
      const out = classifyCheckstyleOutput(result.stdout);
      verdict = out.status;
      text = out.text;
    } else {
      verdict = classifyExit(tool.name, result.status);
      text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    }
    if (verdict !== "issues") return {};

    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `universal-lint: ${tool.name} found issues in ${target}:\n${truncate(text)}`,
      },
    };
  } catch {
    return {};
  }
}

// True only when this file is the process entry point (MCP spawn / `node server.mjs`),
// false when imported by a unit test -- so importing never starts the stdin loop.
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
      name: "lint_file",
      description:
        "PostToolUse Write|Edit linter: runs the language's standard linter (check-only, never --fix) on the just-written file when installed. Returns additionalContext with the findings when issues are found, {} otherwise.",
      inputSchema: { type: "object", additionalProperties: true },
      handler: lintFileHandler,
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
