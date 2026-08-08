#!/usr/bin/env node
// mcp/server.mjs — universal-format plugin. Self-contained, zero-dependency MCP
// stdio server (Node built-ins + a lazily-imported prettier). Backs two hooks:
//   format_pre  (PreToolUse Write|Edit) — prettier languages, in-process, updatedInput
//   format_post (PostToolUse Write|Edit) — non-prettier + prettier-on-PATH + npx net
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs -> stderr.
import process from "node:process";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { accessSync, existsSync, readFileSync, realpathSync, mkdirSync, mkdtempSync, renameSync, symlinkSync, rmSync, readdirSync, writeFileSync, constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SERVER_NAME = "universal-format-hooks"; // keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.9.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // only used if the client omits protocolVersion

const SPAWN_TIMEOUT_MS = 30000; // inner formatter timeout; hook-level timeout:60 is the backstop
const NPX_SPAWN_TIMEOUT_MS = 55000; // cold npx install can exceed SPAWN_TIMEOUT_MS; stay under the hook's 60s ceiling

const PRETTIER_LANGS = new Set(["jsts", "json", "yaml", "markdown", "css", "scss"]);
const MANAGED_PRETTIER_VERSION = "3.9.4";
const DAILY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 120000; // npm install budget; out of band, never blocks a hook

// Per-cwd cache of tier-1/tier-2 classification (session lifetime, like the PATH probe cache).
// A "needs-managed" entry means tiers 1 & 2 were probed and missed; tier 3 is then re-checked live.
/** @type {Map<string, {kind:"in-process",modulePath:string}|{kind:"path-subprocess"}|{kind:"needs-managed"}>} */
const prettierSourceCache = new Map();

/** @type {"idle"|"installing"|"done"|"failed"} */
let managedInstallState = "idle";

/**
 * @typedef {{ name: string, strategy: string, base: string[], nativeConfig?: Array<string | {file: string, section: string}>, guardPrintWidth?: boolean, npmSpec?: string }} FormatTool
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
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".php": "php",
};

// Shared chain-entry descriptor: prettier serves multiple, unrelated language
// chains (jsts/json/yaml/markdown/css/scss) with byte-identical config, unlike
// every other tool in this registry (each of which serves exactly one language).
// buildInvocation() only ever reads this via .slice()/spread, never mutates in
// place, so sharing the same object across chains is safe.
/** @type {FormatTool} */
const PRETTIER_NATIVE = {
  name: "prettier",
  strategy: "native",
  base: ["--write", "--log-level", "silent"],
  npmSpec: "prettier",
};

// Prettier's own project-config search (verified against prettier 3.9.6's
// bundled source: its CONFIG_FILES searcher has no stopDirectory -- the hook
// that would supply one always returns undefined -- so it walks from the
// file's own directory all the way to the filesystem root, never just up to
// `cwd`). Any narrower search here would risk silently overriding a real
// upstream config this plugin never saw -- exactly the failure the guard
// below exists to avoid.
const PRETTIER_CONFIG_FILENAMES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yml",
  ".prettierrc.yaml",
  ".prettierrc.json5",
  ".prettierrc.js",
  "prettier.config.js",
  ".prettierrc.ts",
  "prettier.config.ts",
  ".prettierrc.mjs",
  "prettier.config.mjs",
  ".prettierrc.mts",
  "prettier.config.mts",
  ".prettierrc.cjs",
  "prettier.config.cjs",
  ".prettierrc.cts",
  "prettier.config.cts",
  ".prettierrc.toml",
];

// Walk from `dir` up to the filesystem root (inclusive), calling `checkDir` at
// each level; true on the first hit. Unbounded -- unlike this file's other
// walkers (findNativeConfig, resolveEditorconfig below), which stop at `cwd`
// because their governing tools (ruff/black/.editorconfig) only ever
// look inside the project tree. Prettier's own search has no such bound (see
// above), so bounding this one at `cwd` would misdetect "absent" for a real
// config that lives above the project root (a workspace/monorepo case).
/** @param {string} dir @param {(dir: string) => boolean} checkDir @returns {boolean} */
function walkToRoot(dir, checkDir) {
  for (;;) {
    if (checkDir(dir)) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

// True if a prettier project config governs `fileDir` -- one of prettier's own
// dedicated config files, or a top-level "prettier" key in package.json /
// package.yaml (prettier reads both natively -- loadConfigFromPackageJson /
// loadConfigFromPackageYaml in its own source; package.yaml is pnpm's
// package.json equivalent). package.yaml has no bundled YAML parser here, so
// its "prettier" key is existence-checked via an anchored, top-level-only
// regex -- same accepted residual-risk tradeoff as this file's other
// regex-based heuristics (see resolveEditorconfig's neighbors).
/** @param {string} fileDir @returns {boolean} */
export function hasPrettierProjectConfig(fileDir) {
  return walkToRoot(fileDir, (dir) => {
    if (PRETTIER_CONFIG_FILENAMES.some((name) => existsSync(path.join(dir, name)))) return true;
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg && typeof pkg === "object" && Object.hasOwn(pkg, "prettier")) return true;
      } catch {
        /* unreadable/invalid JSON -> treat as absent */
      }
    }
    const pkgYamlPath = path.join(dir, "package.yaml");
    if (existsSync(pkgYamlPath)) {
      let text = "";
      try {
        text = readFileSync(pkgYamlPath, "utf8");
      } catch {
        /* unreadable -> treat as absent */
      }
      if (/^prettier\s*:/m.test(text)) return true;
    }
    return false;
  });
}

// Large enough that none of prettier's line-wrapping decisions ever trigger --
// effectively "no limit" -- without passing a literal Infinity (rejected by
// prettier's own CLI argument parsing).
const NO_LINE_LENGTH_PRINT_WIDTH = "99999";

// yaml/json only (see REGISTRY): when no prettier project config governs the
// file AND no .editorconfig max_line_length applies (prettier already honors
// that natively when run bare -- verified empirically), force printWidth high
// enough to disable prettier's own built-in 80-column default. A real
// project-level choice, from either source, is always left alone.
/** @param {string[]} base @param {string} file @param {string} cwd @returns {string[]} */
export function guardPrintWidthArgv(base, file, cwd) {
  if (hasPrettierProjectConfig(path.dirname(file))) return base.slice();
  const ec = resolveEditorconfig(file, cwd);
  if (ec.found && typeof ec.props.max_line_length === "number") return base.slice();
  return [...base, "--print-width", NO_LINE_LENGTH_PRINT_WIDTH];
}

/** @type {FormatTool} */
const PRETTIER_LINE_LENGTH_GUARDED = {
  name: "prettier",
  strategy: "native",
  guardPrintWidth: true,
  base: ["--write", "--log-level", "silent"],
  npmSpec: "prettier",
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
  jsts: { chain: [PRETTIER_NATIVE] },
  python: {
    chain: [
      {
        name: "ruff",
        strategy: "mapped",
        nativeConfig: [".ruff.toml", "ruff.toml", { file: "pyproject.toml", section: "tool.ruff" }],
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
  json: { chain: [PRETTIER_LINE_LENGTH_GUARDED] },
  css: { chain: [PRETTIER_NATIVE] },
  scss: { chain: [PRETTIER_NATIVE] },
  yaml: { chain: [PRETTIER_LINE_LENGTH_GUARDED] },
  markdown: { chain: [PRETTIER_NATIVE] },
  php: {
    chain: [
      {
        name: "php-cs-fixer",
        strategy: "native",
        base: ["fix", "--quiet", "--using-cache=no"],
      },
    ],
  },
};

// PATH probe cache (process-lifetime): tool name -> boolean on PATH.
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

// Determine the formatter invocation for a resolved tool.
// guardPrintWidth (prettier's yaml/json entry only) -> its own independent
// check, ahead of the strategy switch below: it inverts that switch's
// "absent config -> run bare" default, so it can't reuse the mapped branch's
// buildInvocation() (whose `!editorconfig` early return is exactly the
// opposite of what this guard needs). native/fixed -> bare. mapped -> if a
// tool-native config governs the file, bare; else resolve .editorconfig for
// this file and map/skip via buildInvocation.
/** @param {FormatTool} tool @param {string} file @param {string} cwd @returns {{argv: string[]} | {skip: true}} */
function resolveInvocation(tool, file, cwd) {
  if (tool.guardPrintWidth) return { argv: guardPrintWidthArgv(tool.base, file, cwd) };
  if (tool.strategy !== "mapped") return buildInvocation(tool);
  const hasNativeConfig = findNativeConfig(path.dirname(file), cwd, tool.nativeConfig ?? []);
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
// Two passes, not one: a chain tool actually on PATH always wins over any other
// chain tool that's merely npx-reachable, regardless of chain order. Without this,
// giving npmSpec to more than one entry would let an earlier entry's npx fallback
// shadow a later entry that's genuinely installed -- npx ships with node, so it's
// essentially always "available."
/** @param {FormatTool[]} chain @param {string} file @param {string} cwd @returns {{tool: FormatTool, argv: string[]} | null} */
function selectFormatter(chain, file, cwd) {
  for (const tool of chain) {
    if (!onPath(tool.name)) continue;
    const inv = resolveInvocation(tool, file, cwd);
    if ("skip" in inv) continue;
    return { tool, argv: inv.argv };
  }
  if (!onPath("npx")) return null;
  for (const tool of chain) {
    if (!tool.npmSpec) continue;
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
    if (typeof ec.indent_size === "number" && ec.indent_size !== 2 && ec.indent_size !== 4) return { skip: true };
    if (typeof ec.max_line_length === "number" && ec.max_line_length < 100) return { skip: true };
    return { argv: ec.indent_size === 4 ? ["--aosp", ...base] : base.slice() };
  },
  "clang-format"(base, ec) {
    // No tool-native config: construct an explicit Google-based style from .editorconfig.
    const parts = ["BasedOnStyle: Google"];
    if (typeof ec.indent_size === "number") parts.push(`IndentWidth: ${ec.indent_size}`);
    if (ec.indent_style) parts.push(`UseTab: ${ec.indent_style === "tab" ? "ForIndentation" : "Never"}`);
    if (typeof ec.max_line_length === "number") parts.push(`ColumnLimit: ${ec.max_line_length}`);
    return { argv: ["-i", `--style={${parts.join(", ")}}`] };
  },
  ruff(base, ec) {
    const argv = base.slice();
    if (typeof ec.max_line_length === "number") argv.push("--line-length", String(ec.max_line_length));
    if (ec.indent_style) argv.push("--config", `format.indent-style='${ec.indent_style}'`);
    if (typeof ec.indent_size === "number") argv.push("--config", `format.indent-width=${ec.indent_size}`);
    return { argv };
  },
  black(base, ec) {
    if (ec.indent_style === "tab") return { skip: true }; // black is hard-fixed 4-space; tabs rejected
    const argv = base.slice();
    if (typeof ec.max_line_length === "number") argv.push("--line-length", String(ec.max_line_length));
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
  if (glob.includes("/") || glob.includes("[") || glob.includes("]") || glob.includes("!")) return null;
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

// True when `rel` (already resolved inside cwd) is dependency/VCS state
// (node_modules/vendor/.git, unchanged) or Claude-Code-owned session/worktree
// machinery that happens to sit inside cwd -- a nested git worktree
// (.claude/worktrees/…) or an agent's local runtime scratch state
// (.claude/agent-memory/…, both gitignored in this repo's own .claude/.gitignore)
// is never real project content, so it's skipped the same way node_modules is.
// This repo's own tracked .claude/rules|agents|skills stay covered -- only
// these two specific subtrees are Claude-Code-internal, not `.claude/` as a
// whole. `*.local.*` (personal local-override files, e.g. settings.local.json)
// is skipped regardless of location, matching the same naming convention.
/** @param {string} rel @returns {boolean} */
export function isExcludedPath(rel) {
  const segments = rel.split(path.sep);
  if (segments.some((s) => s === "node_modules" || s === "vendor" || s === ".git")) return true;
  if (segments.some((s, i) => s === ".claude" && (segments[i + 1] === "worktrees" || segments[i + 1] === "agent-memory"))) return true;
  return segments[segments.length - 1].includes(".local.");
}

// ---- managed-copy read helpers + 3-tier prettier resolver (pure; no install side effects) ----

/** Managed-copy base dir from env, or null when CLAUDE_PLUGIN_DATA is unset/empty.
 * @returns {string|null} */
export function managedPrettierDir() {
  const base = process.env.CLAUDE_PLUGIN_DATA;
  return base ? path.resolve(base, "prettier") : null;
}

/** Installed managed prettier version (reads current/node_modules/prettier/package.json), or null.
 * @param {string} baseDir @returns {string|null} */
export function readManagedPrettierVersion(baseDir) {
  try {
    const pkg = path.join(baseDir, "current", "node_modules", "prettier", "package.json");
    const v = JSON.parse(readFileSync(pkg, "utf8"))?.version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** True when the daily reconcile check is due.
 * @param {number|null} lastCheckMs @param {number} nowMs @returns {boolean} */
export function shouldRunDailyCheck(lastCheckMs, nowMs) {
  return lastCheckMs === null || nowMs - lastCheckMs >= DAILY_CHECK_INTERVAL_MS;
}

/** Classify how (if at all) an in-process/subprocess prettier is available for cwd.
 * Pure (fs reads only, no install trigger). Tiers 1 & 2 cached per cwd for the server
 * lifetime; tier 3 (managed copy) is re-evaluated live so a just-completed lazy install
 * is picked up on the next Write in the same session.
 * @param {string} cwd
 * @returns {{kind:"in-process",modulePath:string}|{kind:"path-subprocess"}|{kind:"none"}} */
export function resolvePrettierSource(cwd) {
  const cached = prettierSourceCache.get(cwd);
  if (cached && cached.kind !== "needs-managed") return cached;
  if (!cached) {
    // Tier 1: project-local importable prettier (a project's own prettier always wins).
    try {
      const req = createRequire(path.join(cwd, "package.json"));
      const modulePath = req.resolve("prettier");
      /** @type {{kind:"in-process",modulePath:string}} */
      const res = { kind: "in-process", modulePath };
      prettierSourceCache.set(cwd, res);
      return res;
    } catch {
      /* not importable from cwd */
    }
    // Tier 2: prettier on PATH -> PostToolUse subprocess owns it.
    if (onPath("prettier")) {
      /** @type {{kind:"path-subprocess"}} */
      const res = { kind: "path-subprocess" };
      prettierSourceCache.set(cwd, res);
      return res;
    }
    prettierSourceCache.set(cwd, { kind: "needs-managed" });
  }
  // Tier 3: managed copy under ${CLAUDE_PLUGIN_DATA}/prettier/current (re-checked live).
  const baseDir = managedPrettierDir();
  if (baseDir) {
    try {
      const req = createRequire(path.join(baseDir, "current", "package.json"));
      const modulePath = req.resolve("prettier");
      return { kind: "in-process", modulePath };
    } catch {
      /* managed copy absent or incomplete */
    }
  }
  return { kind: "none" };
}

/** Dynamically import a resolved prettier entry (works under node and bun; prettier's
 * default export carries format/resolveConfig/clearConfigCache). @param {string} modulePath @returns {Promise<any>} */
async function loadPrettier(modulePath) {
  const mod = await import(pathToFileURL(modulePath).href);
  return mod?.default ?? mod;
}

/** json/yaml only: true when neither a prettier project config nor an .editorconfig
 * max_line_length governs the file (mirror of guardPrintWidthArgv).
 * @param {string} file @param {string} cwd @returns {boolean} */
export function shouldOverridePrintWidth(file, cwd) {
  if (hasPrettierProjectConfig(path.dirname(file))) return false;
  const ec = resolveEditorconfig(file, cwd);
  if (ec.found && typeof ec.props.max_line_length === "number") return false;
  return true;
}

/** Format a whole source string in-process with an already-imported prettier module.
 * @param {any} prettier @param {string} src @param {string} filePath @param {string} cwd @param {string} lang @returns {Promise<string>} */
export async function formatInProcess(prettier, src, filePath, cwd, lang) {
  if (typeof prettier.clearConfigCache === "function") prettier.clearConfigCache();
  const config = (await prettier.resolveConfig(filePath, { editorconfig: true })) ?? {};
  if ((lang === "json" || lang === "yaml") && shouldOverridePrintWidth(filePath, cwd)) config.printWidth = 99999;
  return await prettier.format(src, { ...config, filepath: filePath });
}

/** Apply an Edit in memory (mirrors Claude Code Edit semantics): whole-file swap must
 * never mask a not-found/non-unique error. @param {string} current @param {string} oldStr
 * @param {string} newStr @param {boolean} replaceAll @returns {string|null} */
export function applyEdit(current, oldStr, newStr, replaceAll) {
  if (replaceAll) return current.includes(oldStr) ? current.split(oldStr).join(newStr) : null;
  const idx = current.indexOf(oldStr);
  if (idx === -1) return null;
  if (current.indexOf(oldStr, idx + oldStr.length) !== -1) return null; // non-unique
  return current.slice(0, idx) + newStr + current.slice(idx + oldStr.length);
}

// ---- managed-copy install state machine (staging + atomic flip) ----

/** Best-effort recursive remove; never throws. @param {string} p @returns {void} */
function safeRm(p) {
  try {
    rmSync(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Version of prettier installed under a staging prefix, or null. @param {string} staging @returns {string|null} */
function readInstalledVersion(staging) {
  try {
    const pkg = path.join(staging, "node_modules", "prettier", "package.json");
    const v = JSON.parse(readFileSync(pkg, "utf8"))?.version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Atomically point ${baseDir}/current at a complete staging tree via a temp symlink +
 * rename (atomic replace on POSIX), so a reader never sees a half-installed tree.
 * @param {string} baseDir @param {string} staging @returns {void} */
function publishManagedVersion(baseDir, staging) {
  const current = path.join(baseDir, "current");
  const tmpLink = path.join(baseDir, `.current.${process.pid}.${Date.now()}`);
  safeRm(tmpLink);
  symlinkSync(staging, tmpLink, "dir");
  renameSync(tmpLink, current);
}

/** Remove version dirs other than `keep` and any stale .current.* temp links; best-effort.
 * @param {string} baseDir @param {string} keep @returns {void} */
function gcOldVersions(baseDir, keep) {
  try {
    const versionsDir = path.join(baseDir, "versions");
    for (const name of readdirSync(versionsDir)) {
      const full = path.join(versionsDir, name);
      if (full !== keep) safeRm(full);
    }
  } catch {
    /* ignore */
  }
  try {
    for (const name of readdirSync(baseDir)) {
      if (name.startsWith(".current.")) safeRm(path.join(baseDir, name));
    }
  } catch {
    /* ignore */
  }
}

/** Install prettier@version into a fresh staging dir via async npm (never awaited),
 * then sanity-check + atomically publish on a clean exit. Non-blocking; every failure
 * a silent no-op that leaves `current` untouched. @param {string} baseDir @param {string} version @returns {void} */
function installManagedPrettier(baseDir, version) {
  const versionsDir = path.join(baseDir, "versions");
  mkdirSync(versionsDir, { recursive: true });
  const staging = mkdtempSync(path.join(versionsDir, `${version}-`));
  const child = spawn("npm", ["install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "--loglevel=error", "--prefix", staging, `prettier@${version}`], {
    cwd: baseDir,
    stdio: "ignore",
    timeout: INSTALL_TIMEOUT_MS,
  });
  child.on("error", () => {
    managedInstallState = "failed";
    safeRm(staging);
  });
  child.on("exit", (/** @type {number|null} */ code) => {
    try {
      if (code !== 0) {
        managedInstallState = "failed";
        safeRm(staging);
        return;
      }
      if (readInstalledVersion(staging) !== version) {
        managedInstallState = "failed";
        safeRm(staging);
        return;
      }
      publishManagedVersion(baseDir, staging);
      managedInstallState = "done";
      gcOldVersions(baseDir, staging);
    } catch {
      managedInstallState = "failed";
      safeRm(staging);
    }
  });
  child.unref();
}

/** Lazy managed-copy installer: at most one attempt per server lifetime. Fired
 * fire-and-forget from a tier-none miss; never throws into a hook call; never blocks.
 * @returns {void} */
function ensureManagedPrettierInstalled() {
  if (managedInstallState !== "idle") return;
  const baseDir = managedPrettierDir();
  if (!baseDir) {
    managedInstallState = "failed"; // no data dir -> managed tier disabled
    return;
  }
  managedInstallState = "installing";
  try {
    installManagedPrettier(baseDir, MANAGED_PRETTIER_VERSION);
  } catch {
    managedInstallState = "failed";
  }
}

// ---- daily reconcile-to-pin check ----

/** Daily reconcile-to-pin check: fire-and-forget at server start, never awaited.
 * At most 1 per 24 h (marker written FIRST, claiming the window). Reconciles only an
 * EXISTING managed copy whose version differs from the pin — local version-string
 * compare, no npm-registry query; npm shelled out only to reinstall. Never eager-installs.
 * Every failure a silent no-op. @returns {Promise<void>} */
async function maybeRunDailyUpdateCheck() {
  try {
    const baseDir = managedPrettierDir();
    if (!baseDir) return;
    const marker = path.join(baseDir, ".last-check");
    let last = null;
    try {
      const n = Number(readFileSync(marker, "utf8").trim());
      last = Number.isFinite(n) ? n : null;
    } catch {
      last = null;
    }
    if (!shouldRunDailyCheck(last, Date.now())) return;
    // Claim the window first, so a failed/offline check still counts (at most one/day).
    try {
      mkdirSync(baseDir, { recursive: true });
      writeFileSync(marker, String(Date.now()));
    } catch {
      return;
    }
    const installed = readManagedPrettierVersion(baseDir);
    if (installed === null) return; // no managed copy -> never eager-install
    if (installed === MANAGED_PRETTIER_VERSION) return; // already at the pin
    installManagedPrettier(baseDir, MANAGED_PRETTIER_VERSION); // reconcile (same staging + atomic flip)
  } catch {
    /* silent fail-open */
  }
}

// ---- format_post handler (today's behavior + one prettier-ownership guard) ----

/** PostToolUse handler. Today's format-file behavior plus one prettier-ownership guard.
 * Returns {} on every guard failure / error (fail open).
 * @param {PostToolUseHookInput} args @returns {Promise<HookResult>} */
export async function formatPost(args) {
  try {
    if (args?.tool_response?.success === false) return {};
    const cwd = typeof args?.cwd === "string" ? args.cwd : "";
    const fp = args?.tool_input?.file_path;
    if (!cwd || typeof fp !== "string" || !fp) return {};

    const resolved = path.resolve(cwd, fp);
    if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) return {};
    const rel = path.relative(cwd, resolved);
    if (isExcludedPath(rel)) return {};

    const lang = EXT_MAP[path.extname(resolved).toLowerCase()];
    if (!lang) return {};
    if (!existsSync(resolved)) return {};

    // Prettier-ownership guard: an in-process-handled prettier language (tier 1/3) was
    // already formatted before the write by format_pre -> nothing to do here. On `none`,
    // warm the managed copy for later calls but STILL fall through to the existing chain
    // (the npx safety net). `path-subprocess` (tier 2) also falls through (direct binary).
    if (PRETTIER_LANGS.has(lang)) {
      const src = resolvePrettierSource(cwd);
      if (src.kind === "in-process") return {};
      if (src.kind === "none") ensureManagedPrettierInstalled();
    }

    // Cached O(1) PATH probe short-circuits before selectFormatter's fuller walk.
    const candidate = REGISTRY[lang].chain.find((t) => isToolAvailable(t, onPath(t.name), onPath("npx")));
    if (!candidate) return {};

    const selection = selectFormatter(REGISTRY[lang].chain, resolved, cwd);
    if (!selection) return {};
    const { tool, argv } = selection;

    const [cmd, cmdArgv, timeout] = onPath(tool.name)
      ? [tool.name, [...argv, resolved], SPAWN_TIMEOUT_MS]
      : ["npx", ["--yes", /** @type {string} */ (tool.npmSpec), ...argv, resolved], NPX_SPAWN_TIMEOUT_MS];

    const before = readFileSync(resolved);
    try {
      spawnSync(cmd, cmdArgv, { cwd, timeout, stdio: "ignore" });
    } catch {
      /* spawn failure is a silent no-op */
    }
    const after = readFileSync(resolved);
    if (before.equals(after)) return {};

    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        // eslint-disable-next-line max-len -- long line is the literal message string
        additionalContext: `universal-format: ${tool.name} reformatted ${rel}; re-read it before further string-based edits. This reformat is intentional and exempt from "surgical/minimal-diff" change-scope rules — do not revert or redo it by hand to shrink the diff.`,
      },
    };
  } catch {
    return {};
  }
}

// ---- format_pre handler (in-process prettier path via updatedInput) ----

/** PreToolUse handler: prettier languages formatted in-process before the write via
 * updatedInput, only when resolvePrettierSource returns in-process (tier 1 or 3).
 * Never sets permissionDecision. Returns {} on every guard failure / error (fail open).
 * @param {ToolHookInput} args @returns {Promise<HookResult>} */
export async function formatPre(args) {
  try {
    const cwd = typeof args?.cwd === "string" ? args.cwd : "";
    const fp = args?.tool_input?.file_path;
    if (!cwd || typeof fp !== "string" || !fp) return {};

    const resolved = path.resolve(cwd, fp);
    if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) return {};
    const rel = path.relative(cwd, resolved);
    if (isExcludedPath(rel)) return {};

    const lang = EXT_MAP[path.extname(resolved).toLowerCase()];
    if (!lang || !PRETTIER_LANGS.has(lang)) return {};

    const src = resolvePrettierSource(cwd);
    if (src.kind === "path-subprocess") return {}; // tier 2 -> format_post owns it
    if (src.kind === "none") {
      ensureManagedPrettierInstalled(); // fire out of band; fail open now
      return {};
    }
    const prettier = await loadPrettier(src.modulePath); // tier 1 or 3, in-process

    // eslint-disable-next-line max-len -- literal reformat notice; verbatim except hookEventName
    const notice = `universal-format: prettier reformatted ${rel}; re-read it before further string-based edits. This reformat is intentional and exempt from "surgical/minimal-diff" change-scope rules — do not revert or redo it by hand to shrink the diff.`;

    if (args.tool_name === "Write") {
      const content = args.tool_input.content;
      if (typeof content !== "string") return {};
      const formatted = await formatInProcess(prettier, content, resolved, cwd, lang);
      if (formatted === content) return {};
      return { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { file_path: fp, content: formatted }, additionalContext: notice } };
    }

    if (args.tool_name === "Edit") {
      if (!existsSync(resolved)) return {};
      const current = readFileSync(resolved, "utf8");
      const oldStr = args.tool_input.old_string;
      const newStr = args.tool_input.new_string;
      if (typeof oldStr !== "string" || typeof newStr !== "string") return {};
      const merged = applyEdit(current, oldStr, newStr, args.tool_input.replace_all === true);
      if (merged === null) return {}; // absent OR non-unique -> let the original Edit proceed/err
      const formatted = await formatInProcess(prettier, merged, resolved, cwd, lang);
      if (formatted === merged) return {};
      return { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { file_path: fp, old_string: current, new_string: formatted, replace_all: false }, additionalContext: notice } };
    }

    return {};
  } catch {
    return {};
  }
}

// True only when this file is the process entry point (MCP spawn / `node server.mjs`),
// false when imported by a unit test — so importing never starts the stdin loop.
function isMainModule() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// ---- MCP scaffold + startup ----

function startServer() {
  const TOOLS = [
    {
      name: "format_pre",
      description:
        "PreToolUse Write|Edit: format prettier-language files in-process before the write (updatedInput) when an in-process prettier is available (project-local or the plugin-managed copy).",
      inputSchema: { type: "object", additionalProperties: true },
      handler: formatPre,
    },
    {
      name: "format_post",
      description:
        "PostToolUse Write|Edit: format the just-written file with the language's formatter (subprocess); prettier on PATH and the npx safety net for prettier languages with no in-process prettier.",
      inputSchema: { type: "object", additionalProperties: true },
      handler: formatPost,
    },
  ];
  const findTool = (/** @type {any} */ name) => TOOLS.find((t) => t.name === name);
  const send = (/** @type {any} */ msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  const ok = (/** @type {any} */ id, /** @type {any} */ result) => send({ jsonrpc: "2.0", id, result });
  const fail = (/** @type {any} */ id, /** @type {any} */ code, /** @type {any} */ message) => send({ jsonrpc: "2.0", id, error: { code, message } });

  const handle = async (/** @type {any} */ msg) => {
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
          const err = /** @type {any} */ (e);
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
    Promise.resolve(handle(msg)).catch((/** @type {any} */ e) => process.stderr.write(`[${SERVER_NAME}] handler crash: ${e?.stack ?? e}\n`));
  });
  rl.on("close", () => process.exit(0));

  void maybeRunDailyUpdateCheck();
}

if (isMainModule()) startServer();
