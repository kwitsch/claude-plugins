#!/usr/bin/env node
// init-dprint skill helper for the starter dprint config.
// `detect` (read-only): prints one JSON line naming the first existing dprint config
// (dprint's own lookup names) and the dprint global settings that .editorconfig,
// .gitattributes and the Prettier config in the working directory declare.
// Contract: dprint-config.reference.md. All paths are relative to the working directory.

import { existsSync, readFileSync } from "node:fs";

// dprint's lookup order (resolve_main_config_path.rs): POSSIBLE_CONFIG_FILE_NAMES in cwd,
// then DOT_CONFIG_FILE_NAMES in .config/ (non-dot names only).
const DPRINT_CONFIG_PATHS = ["dprint.json", "dprint.jsonc", ".dprint.json", ".dprint.jsonc", ".config/dprint.json", ".config/dprint.jsonc"];

// Copied from src/universal-format-mcp/prettier.ts PRETTIER_CONFIG_FILENAMES (same order).
const PRETTIER_FILES = [
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

const TARGET = ".dprint.jsonc";
// dprint's global config keys; also the output key order.
const KEYS = ["lineWidth", "indentWidth", "useTabs", "newLineKind"];
const USAGE = "usage: node dprint-config.mjs detect";

/**
 * @typedef {{ lineWidth?: number, indentWidth?: number, useTabs?: boolean, newLineKind?: string }} Settings
 * @typedef {{ file: string, settings: Settings | null }} Source
 * @typedef {{ code: number, out: Record<string, unknown> }} Result
 */

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is number} true for a positive integer (the only width dprint accepts)
 */
function isPositiveInt(v) {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/**
 * @param {string | undefined} v editorconfig value
 * @returns {number | undefined} the value as a positive integer, else undefined
 */
function editorconfigInt(v) {
  return v !== undefined && /^[1-9]\d*$/.test(v) ? Number(v) : undefined;
}

/**
 * @param {string} msg
 * @returns {Result} exit 2 with {"error": msg}; msg also goes to stderr
 */
function fail(msg) {
  process.stderr.write(`dprint-config: ${msg}\n`);
  return { code: 2, out: { error: msg } };
}

/**
 * @param {string} text .editorconfig content
 * @returns {Settings}
 */
function parseEditorconfig(text) {
  // shortcut: only the [*] section is read (other globs, root and parent dirs ignored), add glob matching if per-language settings are ever adopted
  /** @type {Record<string, string>} */
  const p = {};
  let inStar = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[")) {
      inStar = line === "[*]";
      continue;
    }
    const eq = line.indexOf("=");
    if (!inStar || eq < 0) continue;
    p[line.slice(0, eq).trim().toLowerCase()] = line
      .slice(eq + 1)
      .trim()
      .toLowerCase();
  }
  /** @type {Settings} */
  const s = {};
  const lineWidth = editorconfigInt(p.max_line_length);
  if (lineWidth !== undefined) s.lineWidth = lineWidth;
  const indentWidth = editorconfigInt(p.indent_size) ?? editorconfigInt(p.tab_width);
  if (indentWidth !== undefined) s.indentWidth = indentWidth;
  if (p.indent_style === "tab" || p.indent_style === "space") s.useTabs = p.indent_style === "tab";
  if (p.end_of_line === "lf" || p.end_of_line === "crlf") s.newLineKind = p.end_of_line;
  return s;
}

/**
 * @param {string} text .gitattributes content
 * @returns {Settings}
 */
function parseGitattributes(text) {
  /** @type {Settings} */
  const s = {};
  for (const raw of text.split(/\r?\n/)) {
    const [pattern, ...attrs] = raw.trim().split(/\s+/);
    if (pattern !== "*") continue;
    for (const a of attrs) if (a === "eol=lf" || a === "eol=crlf") s.newLineKind = a.slice(4);
  }
  return s;
}

/**
 * @param {Record<string, unknown>} o Prettier options object
 * @returns {Settings}
 */
function mapPrettier(o) {
  /** @type {Settings} */
  const s = {};
  const { printWidth, tabWidth, useTabs, endOfLine } = o;
  if (isPositiveInt(printWidth)) s.lineWidth = printWidth;
  if (isPositiveInt(tabWidth)) s.indentWidth = tabWidth;
  if (typeof useTabs === "boolean") s.useTabs = useTabs;
  if (endOfLine === "lf" || endOfLine === "crlf") s.newLineKind = endOfLine;
  return s;
}

/**
 * @param {string} text YAML Prettier config
 * @returns {Record<string, unknown>} top-level scalar keys
 */
function parseFlatYaml(text) {
  // shortcut: reads only unindented `key: scalar` lines (nested maps, lists and overrides ignored), use a YAML parser if more Prettier keys are adopted
  /** @type {Record<string, unknown>} */
  const o = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):\s+(.*?)\s*$/.exec(line);
    if (!m) continue;
    const v = m[2].replace(/\s+#.*$/, "").replace(/^(["'])(.*)\1$/, "$2");
    o[m[1]] = v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) ? Number(v) : v;
  }
  return o;
}

/**
 * @param {string} file Prettier config file name
 * @param {string} text its content
 * @returns {Settings | null} null for formats this script cannot read
 */
function parsePrettier(file, text) {
  if (file === ".prettierrc" || file === ".prettierrc.json") {
    try {
      const v = JSON.parse(text);
      return isObject(v) ? mapPrettier(v) : null;
    } catch {
      if (file === ".prettierrc.json") return null;
    }
  }
  if (file === ".prettierrc" || file === ".prettierrc.yml" || file === ".prettierrc.yaml") return mapPrettier(parseFlatYaml(text));
  return null;
}

/**
 * @param {string} file cwd-relative path
 * @param {(text: string) => Settings | null} parse
 * @returns {Source | null} null when the file does not exist; settings null when unreadable
 */
function readSource(file, parse) {
  if (!existsSync(file)) return null;
  try {
    return { file, settings: parse(readFileSync(file, "utf8")) };
  } catch {
    return { file, settings: null };
  }
}

/**
 * @returns {Source | null} the first Prettier config found (package.json key first), or null
 */
function prettierSource() {
  if (existsSync("package.json")) {
    /** @type {unknown} */
    let pkg;
    try {
      pkg = JSON.parse(readFileSync("package.json", "utf8"));
    } catch {
      return { file: "package.json", settings: null };
    }
    if (isObject(pkg) && Object.hasOwn(pkg, "prettier")) {
      // a string value names a shared config this script does not resolve
      const cfg = pkg.prettier;
      return {
        file: "package.json",
        settings: isObject(cfg) ? mapPrettier(cfg) : null,
      };
    }
  }
  const file = PRETTIER_FILES.find((f) => existsSync(f));
  return file === undefined ? null : readSource(file, (text) => parsePrettier(file, text));
}

/**
 * @returns {Result}
 */
function detect() {
  const existing = DPRINT_CONFIG_PATHS.find((p) => existsSync(p)) ?? null;
  /** @type {Source[]} */
  const sources = [];
  for (const s of [readSource(".editorconfig", parseEditorconfig), readSource(".gitattributes", parseGitattributes), prettierSource()]) {
    if (s !== null) sources.push(s);
  }
  return { code: 0, out: { existing, sources } };
}

/**
 * @param {string[]} argv arguments after the script path
 * @returns {Result}
 */
function main(argv) {
  const [mode, ...rest] = argv;
  if (mode === "detect" && rest.length === 0) return detect();
  return fail(USAGE);
}

/** @type {Result} */
let r;
try {
  r = main(process.argv.slice(2));
} catch (e) {
  r = fail(e instanceof Error ? e.message : String(e));
}
process.stdout.write(JSON.stringify(r.out) + "\n");
process.exit(r.code);
