#!/usr/bin/env node
// hooks/format-file.mjs — universal-format plugin: PostToolUse Write|Edit auto-formatter.
// Command hook, invoked directly per event (no MCP server). stdin = hook JSON
// (PostToolUseHookInput), stdout = hook result JSON (hookSpecificOutput.additionalContext)
// or nothing when the file was unchanged. Synchronous (no async in hooks.json) —
// the reformat must land, and Claude must see the notice, before the next tool call
// touches the file.
//
// format_file flow (every failure path returns {} silently — fail open):
//   guard tool_response.success !== false -> ext in registry -> path inside cwd and not
//   excluded (node_modules/vendor/.git, .claude/worktrees, .claude/agent-memory,
//   *.local.* -- see isExcludedPath) -> file exists -> some chain tool on PATH (probes
//   cached) -> selectFormatter walks the chain in order, skipping a tool that's
//   absent or hits a hard style conflict, and falls through to the next -> spawnSync
//   (cwd = project cwd, 30s timeout, stdio ignored) -> before/after content diff
//   (NEVER exit codes) -> changed: additionalContext one-liner; unchanged or no
//   chain tool can run: nothing printed.
import process from "node:process";
import { spawnSync } from "node:child_process";
import { accessSync, existsSync, readFileSync, realpathSync, constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SPAWN_TIMEOUT_MS = 30000; // inner formatter timeout; hook-level timeout:60 is the backstop
const NPX_SPAWN_TIMEOUT_MS = 55000; // cold npx install can exceed SPAWN_TIMEOUT_MS; stay under the hook's 60s ceiling

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
    if (isExcludedPath(rel)) return {};

    const lang = EXT_MAP[path.extname(resolved).toLowerCase()];
    if (!lang) return {};
    if (!existsSync(resolved)) return {};

    // Cached O(1) PATH probe short-circuits before selectFormatter's fuller walk.
    const candidate = REGISTRY[lang].chain.find((t) => isToolAvailable(t, onPath(t.name), onPath("npx")));
    if (!candidate) return {};

    const selection = selectFormatter(REGISTRY[lang].chain, resolved, cwd);
    if (!selection) return {};
    const { tool, argv } = selection;

    // isToolAvailable() already guaranteed npmSpec is set when tool.name isn't on PATH.
    // npx gets its own, more generous timeout: a cold `npx --yes <pkg>` install can
    // exceed the local-binary budget on a slow network or fresh CI runner.
    const [cmd, cmdArgv, timeout] = onPath(tool.name)
      ? [tool.name, [...argv, resolved], SPAWN_TIMEOUT_MS]
      : ["npx", ["--yes", /** @type {string} */ (tool.npmSpec), ...argv, resolved], NPX_SPAWN_TIMEOUT_MS];

    const before = readFileSync(resolved);
    try {
      spawnSync(cmd, cmdArgv, {
        cwd,
        timeout,
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
        // eslint-disable-next-line max-len -- long line is the literal message string
        additionalContext: `universal-format: ${tool.name} reformatted ${rel}; re-read it before further string-based edits. This reformat is intentional and exempt from "surgical/minimal-diff" change-scope rules — do not revert or redo it by hand to shrink the diff.`,
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
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/** Read the hook's stdin JSON, run formatFileHandler, print the result JSON (or
 * nothing) to stdout. Fails open on any error — no output, exit 0. */
function main() {
  try {
    const raw = readFileSync(0, "utf8");
    const input = JSON.parse(raw);
    const result = formatFileHandler(input);
    if (result && Object.keys(result).length > 0) {
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  } catch {
    // fail open — no output, exit 0
  }
}

if (isMainModule()) main();
