#!/usr/bin/env node
// mcp/server.mjs — universal-format plugin: PostToolUse Write|Edit auto-formatter.
// Self-contained, zero-dependency MCP stdio server (Node built-ins only).
// Invoked directly as the .mcp.json command (#!/usr/bin/env node; node-only, no wrapper).
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs -> stderr.
//
// format_file flow (every failure path returns {} silently — fail open):
//   guard tool_response.success !== false -> ext in registry -> path inside cwd and not
//   under node_modules/vendor/.git -> file exists -> some chain tool on PATH (probes
//   cached) -> auto_format not literal false -> selectFormatter walks the chain in
//   order, skipping a tool that's absent or hits a hard style conflict, and falls
//   through to the next -> spawnSync (cwd = project cwd, 30s timeout, stdio ignored)
//   -> before/after content diff (NEVER exit codes) -> changed: additionalContext
//   one-liner; unchanged or no chain tool can run: {}.
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
 * @typedef {{ name: string, strategy: string, base: string[], nativeConfig?: Array<string | {file: string, section: string}>, npmSpec?: string }} FormatTool
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
        npmSpec: "prettier",
      },
      {
        name: "biome",
        strategy: "mapped",
        nativeConfig: ["biome.json", "biome.jsonc"],
        base: ["format", "--write", "--log-level=none"],
        npmSpec: "@biomejs/biome",
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

// A tool is available directly on PATH, or indirectly via `npx <npmSpec>` when
// the registry declares npmSpec (a verified-official npm package only -- see
// the REGISTRY comments) and npx itself is on PATH. Booleans are passed in
// rather than calling onPath() internally so this stays a pure, unit-testable
// function.
/** @param {Pick<FormatTool, "name" | "npmSpec">} tool @param {boolean} toolOnPath @param {boolean} npxOnPath @returns {boolean} */
export function isToolAvailable(tool, toolOnPath, npxOnPath) {
  return toolOnPath || (!!tool.npmSpec && npxOnPath);
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

// Determine the formatter invocation for a resolved tool.
// native/fixed -> bare. mapped -> if a tool-native config governs the file, bare;
// else resolve .editorconfig for this file and map/skip via buildInvocation.
/** @param {FormatTool} tool @param {string} file @param {string} cwd @returns {{argv: string[]} | {skip: true}} */
function resolveInvocation(tool, file, cwd) {
  if (tool.strategy !== "mapped") return buildInvocation(tool);
  const hasNativeConfig = findNativeConfig(
    path.dirname(file),
    cwd,
    tool.nativeConfig ?? [],
  );
  let editorconfig = null;
  if (!hasNativeConfig) {
    const ec = resolveEditorconfig(file, cwd);
    if (ec.found) editorconfig = ec.props;
  }
  return buildInvocation(tool, { hasNativeConfig, editorconfig });
}

// Try each formatter in the language's chain, in order: skip a tool that isn't on
// PATH, or whose resolveInvocation reports a hard style conflict (skip:true), and
// fall through to the next chain entry rather than aborting. Returns the first
// {tool, argv} that can actually run, or null if none of them can.
/** @param {FormatTool[]} chain @param {string} file @param {string} cwd @returns {{tool: FormatTool, argv: string[]} | null} */
function selectFormatter(chain, file, cwd) {
  for (const tool of chain) {
    if (!isToolAvailable(tool, onPath(tool.name), onPath("npx"))) continue;
    const inv = resolveInvocation(tool, file, cwd);
    if ("skip" in inv) continue;
    return { tool, argv: inv.argv };
  }
  return null;
}

// ---- .editorconfig resolver + registry flag mapping (pure, unit-tested) ----

/**
 * @typedef {{ indent_style?: string, indent_size?: number|string, max_line_length?: number, end_of_line?: string }} EditorConfigProps
 */

// Build the argv-tail for a mapped tool given whether a tool-native config governs the
// file and the resolved .editorconfig props (null = no .editorconfig found). Returns
// {argv} to run, or {skip:true} for a hard style conflict the tool cannot honor.
/** @param {FormatTool} tool @param {{hasNativeConfig?: boolean, editorconfig?: EditorConfigProps|null}} [opts] @returns {{argv: string[]} | {skip: true}} */
export function buildInvocation(tool, opts = {}) {
  const { hasNativeConfig = false, editorconfig = null } = opts;
  if (tool.strategy !== "mapped") return { argv: tool.base.slice() };
  if (hasNativeConfig || !editorconfig) return { argv: tool.base.slice() };
  const mapper = MAPPERS[tool.name];
  return mapper ? mapper(tool.base, editorconfig) : { argv: tool.base.slice() };
}

// Per-tool .editorconfig -> CLI-flag mappers. Only reached when the tool is "mapped",
// no tool-native config governs, and an .editorconfig was found for the file.
/** @type {Record<string, (base: string[], ec: EditorConfigProps) => {argv: string[]} | {skip: true}>} */
const MAPPERS = {
  "google-java-format"(base, ec) {
    // gjf is fixed at spaces-only, 100-col, 2/4-space indent. Skip on any conflict.
    if (ec.indent_style === "tab") return { skip: true };
    if (ec.indent_size === "tab") return { skip: true };
    if (
      typeof ec.indent_size === "number" &&
      ec.indent_size !== 2 &&
      ec.indent_size !== 4
    )
      return { skip: true };
    if (typeof ec.max_line_length === "number" && ec.max_line_length < 100)
      return { skip: true };
    return { argv: ec.indent_size === 4 ? ["--aosp", ...base] : base.slice() };
  },
  "clang-format"(base, ec) {
    // No tool-native config: construct an explicit Google-based style from .editorconfig.
    const parts = ["BasedOnStyle: Google"];
    if (typeof ec.indent_size === "number")
      parts.push(`IndentWidth: ${ec.indent_size}`);
    if (ec.indent_style)
      parts.push(
        `UseTab: ${ec.indent_style === "tab" ? "ForIndentation" : "Never"}`,
      );
    if (typeof ec.max_line_length === "number")
      parts.push(`ColumnLimit: ${ec.max_line_length}`);
    return { argv: ["-i", `--style={${parts.join(", ")}}`] };
  },
  biome(base, ec) {
    const argv = base.slice();
    if (ec.indent_style) argv.push(`--indent-style=${ec.indent_style}`);
    if (typeof ec.indent_size === "number")
      argv.push(`--indent-width=${ec.indent_size}`);
    if (ec.end_of_line) argv.push(`--line-ending=${ec.end_of_line}`);
    if (typeof ec.max_line_length === "number")
      argv.push(`--line-width=${ec.max_line_length}`);
    return { argv };
  },
  ruff(base, ec) {
    const argv = base.slice();
    if (typeof ec.max_line_length === "number")
      argv.push("--line-length", String(ec.max_line_length));
    if (ec.indent_style)
      argv.push("--config", `format.indent-style='${ec.indent_style}'`);
    if (typeof ec.indent_size === "number")
      argv.push("--config", `format.indent-width=${ec.indent_size}`);
    return { argv };
  },
  black(base, ec) {
    if (ec.indent_style === "tab") return { skip: true }; // black is hard-fixed 4-space; tabs rejected
    const argv = base.slice();
    if (typeof ec.max_line_length === "number")
      argv.push("--line-length", String(ec.max_line_length));
    return { argv };
  },
};

// Walk from the file's dir up to cwd (inclusive); return true if a tool-native config
// governs the file. Entry: a filename (existence) or {file, section} — file must exist
// AND contain a `[section]` or `[section.*]` TOML header.
/** @param {string} fileDir @param {string} cwd @param {Array<string | {file: string, section: string}>} entries @returns {boolean} */
export function findNativeConfig(fileDir, cwd, entries) {
  let dir = fileDir;
  for (;;) {
    for (const entry of entries) {
      if (typeof entry === "string") {
        if (existsSync(path.join(dir, entry))) return true;
      } else {
        const p = path.join(dir, entry.file);
        if (existsSync(p)) {
          let text = "";
          try {
            text = readFileSync(p, "utf8");
          } catch {
            /* unreadable config file -> treat as absent */
          }
          const escaped = entry.section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const re = new RegExp("^\\s*\\[" + escaped + "(\\.[^\\]]*)?\\]", "m");
          if (re.test(text)) return true;
        }
      }
    }
    if (dir === cwd) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root safety
    dir = parent;
  }
  return false;
}

// Resolve .editorconfig props for a file by walking dir->cwd (inclusive), stopping after
// a file with root=true. Sections applied farthest-first, later-section-wins, so nearer
// files and later matching sections override. Returns {found, props}.
/** @param {string} file @param {string} cwd @returns {{found: boolean, props: EditorConfigProps}} */
export function resolveEditorconfig(file, cwd) {
  const basename = path.basename(file);
  /** @type {Array<{root: boolean, sections: Array<{glob: string, props: Record<string,string>}>}>} */
  const parsed = []; // nearest-first as we ascend
  let dir = path.dirname(file);
  for (;;) {
    const p = path.join(dir, ".editorconfig");
    if (existsSync(p)) {
      let text = "";
      try {
        text = readFileSync(p, "utf8");
      } catch {
        /* unreadable .editorconfig -> treat as absent */
      }
      const pf = parseEditorconfig(text);
      parsed.push(pf);
      if (pf.root) break; // stop climbing at root=true
    }
    if (dir === cwd) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (parsed.length === 0) return { found: false, props: {} };
  /** @type {Record<string, string>} */
  const raw = {};
  for (const pf of parsed.slice().reverse()) {
    // farthest-first so nearer wins
    for (const section of pf.sections) {
      if (matchGlob(section.glob, basename)) Object.assign(raw, section.props);
    }
  }
  return { found: true, props: normalizeProps(raw) };
}

// Parse .editorconfig INI text into { root, sections:[{glob, props}] }. Comments (# / ;)
// and blanks ignored. Keys before the first [section] contribute root=true only.
/** @param {string} text @returns {{root: boolean, sections: Array<{glob: string, props: Record<string,string>}>}} */
export function parseEditorconfig(text) {
  let root = false;
  /** @type {Array<{glob: string, props: Record<string,string>}>} */
  const sections = [];
  /** @type {{glob: string, props: Record<string,string>} | null} */
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || s.startsWith(";")) continue;
    const sec = s.match(/^\[(.*)\]$/);
    if (sec) {
      current = { glob: sec[1].trim(), props: {} };
      sections.push(current);
      continue;
    }
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    const key = s.slice(0, eq).trim().toLowerCase();
    const value = s.slice(eq + 1).trim();
    if (!current) {
      if (key === "root") root = value.toLowerCase() === "true";
      continue;
    }
    current.props[key] = value;
  }
  return { root, sections };
}

// Match an editorconfig section glob against a file basename, supporting only the
// separatorless subset *, *.ext, *.{a,b}, **.ext. Any unsupported form (path separator,
// charset [], negation !, brace range {n..m}) -> false (fail toward "no mapping").
/** @param {string} glob @param {string} basename @returns {boolean} */
export function matchGlob(glob, basename) {
  const re = globToRegExp(glob);
  return re ? re.test(basename) : false;
}

/** @param {string} glob @returns {RegExp | null} */
function globToRegExp(glob) {
  if (
    glob.includes("/") ||
    glob.includes("[") ||
    glob.includes("]") ||
    glob.includes("!")
  )
    return null;
  if (/\{[^}]*\.\.[^}]*\}/.test(glob)) return null; // brace range {1..9}
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += ".";
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) return null;
      const parts = glob
        .slice(i + 1, end)
        .split(",")
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      re += "(?:" + parts.join("|") + ")";
      i = end;
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + re + "$");
}

// Normalize raw string props to typed EditorConfigProps (lowercased styles; finite
// numbers only — a non-numeric/invalid value is dropped rather than emitted as NaN).
/** @param {Record<string, string>} raw @returns {EditorConfigProps} */
function normalizeProps(raw) {
  /** @type {EditorConfigProps} */
  const out = {};
  if (raw.indent_style) out.indent_style = raw.indent_style.toLowerCase();
  if (raw.indent_size !== undefined) {
    const v = raw.indent_size.toLowerCase();
    if (v === "tab") out.indent_size = "tab";
    else {
      const n = Number(v);
      if (Number.isFinite(n)) out.indent_size = n;
    }
  }
  if (raw.max_line_length !== undefined) {
    const v = raw.max_line_length.toLowerCase();
    if (v !== "off") {
      const n = Number(v);
      if (Number.isFinite(n)) out.max_line_length = n;
    }
  }
  if (raw.end_of_line) out.end_of_line = raw.end_of_line.toLowerCase();
  return out;
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

    // Cached O(1) PATH probe before the uncached settings-file reads.
    const candidate = REGISTRY[lang].chain.find((t) =>
      isToolAvailable(t, onPath(t.name), onPath("npx")),
    );
    if (!candidate) return {};
    if (!isAutoFormatEnabled(cwd)) return {};

    const selection = selectFormatter(REGISTRY[lang].chain, resolved, cwd);
    if (!selection) return {};
    const { tool, argv } = selection;

    // isToolAvailable() already guaranteed npmSpec is set when tool.name isn't on PATH.
    const [cmd, cmdArgv] = onPath(tool.name)
      ? [tool.name, [...argv, resolved]]
      : [
          "npx",
          ["--yes", /** @type {string} */ (tool.npmSpec), ...argv, resolved],
        ];

    const before = readFileSync(resolved);
    try {
      spawnSync(cmd, cmdArgv, {
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
