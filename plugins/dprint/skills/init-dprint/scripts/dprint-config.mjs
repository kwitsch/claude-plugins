#!/usr/bin/env node
// init-dprint skill helper for the starter dprint config.
// `detect` (read-only): prints one JSON line naming the first existing dprint config
// (dprint's own lookup names) and the dprint global settings that .editorconfig,
// .gitattributes and the Prettier config in the working directory declare.
// `write [key=value ...]`: creates ./.dprint.jsonc with exclusive create; never
// overwrites or duplicates a dprint config.
// Contract: dprint-config.reference.md. All paths are relative to the working directory.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

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
const USAGE = "usage: node dprint-config.mjs detect | write [key=value ...]";
// newLineKind values allowed by https://dprint.dev/schemas/v0.json
const NEW_LINE_KINDS = ["auto", "crlf", "lf", "system"];
// dprint reads lineWidth and indentWidth as u32; larger values make dprint reject its own config
const U32_MAX = 4294967295;

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
 * @returns {v is number} true for a positive integer up to U32_MAX (the only width dprint accepts)
 */
function isPositiveInt(v) {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= U32_MAX;
}

/**
 * @param {string | undefined} v decimal string
 * @returns {number | undefined} the value as a positive integer within dprint's range, else undefined
 */
function parseWidth(v) {
  if (v === undefined || !/^[1-9]\d*$/.test(v)) return undefined;
  const n = Number(v);
  return isPositiveInt(n) ? n : undefined;
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
  const lineWidth = parseWidth(p.max_line_length);
  if (lineWidth !== undefined) s.lineWidth = lineWidth;
  const indentWidth = parseWidth(p.indent_size) ?? parseWidth(p.tab_width);
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
      // JSON-looking text that failed to parse (trailing comma, comments) must not fall through to the flat-YAML reader, which would report it as "nothing maps"
      if (file === ".prettierrc.json" || /^\s*(\/[/*]|[{[])/.test(text)) return null;
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
 * @param {string[]} args `key=value` arguments
 * @returns {Result}
 */
function write(args) {
  /** @type {Record<string, number | boolean | string>} */
  const settings = {};
  for (const arg of args) {
    const eq = arg.indexOf("=");
    const key = arg.slice(0, eq);
    const value = arg.slice(eq + 1);
    if (eq < 1 || !KEYS.includes(key)) return fail(`invalid argument '${arg}': expected key=value with key one of ${KEYS.join(", ")}`);
    if (Object.hasOwn(settings, key)) return fail(`duplicate key '${key}'`);
    if (key === "useTabs") {
      if (value !== "true" && value !== "false") return fail(`useTabs must be true or false, got '${value}'`);
      settings[key] = value === "true";
    } else if (key === "newLineKind") {
      if (!NEW_LINE_KINDS.includes(value)) return fail(`newLineKind must be one of ${NEW_LINE_KINDS.join(", ")}, got '${value}'`);
      settings[key] = value;
    } else {
      const n = parseWidth(value);
      if (n === undefined) return fail(`${key} must be a positive integer up to ${U32_MAX}, got '${value}'`);
      settings[key] = n;
    }
  }
  const existing = DPRINT_CONFIG_PATHS.find((p) => existsSync(p));
  if (existing !== undefined) return { code: 3, out: { existing } };
  /** @type {Record<string, unknown>} */
  const config = { $schema: "https://dprint.dev/schemas/v0.json" };
  for (const k of KEYS) if (Object.hasOwn(settings, k)) config[k] = settings[k];
  config.plugins = [];
  try {
    writeFileSync(TARGET, JSON.stringify(config, null, 2) + "\n", { flag: "wx" });
  } catch (e) {
    // lost a race against another writer: still never clobber
    if (e instanceof Error && "code" in e && e.code === "EEXIST") return { code: 3, out: { existing: TARGET } };
    throw e;
  }
  return { code: 0, out: { written: TARGET } };
}

/**
 * @param {string[]} argv arguments after the script path
 * @returns {Result}
 */
function main(argv) {
  const [mode, ...rest] = argv;
  if (mode === "detect" && rest.length === 0) return detect();
  if (mode === "write") return write(rest);
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
