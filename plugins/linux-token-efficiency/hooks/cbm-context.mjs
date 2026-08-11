#!/usr/bin/env node
// hooks/cbm-context.mjs — linux-token-efficiency: fail-open, context-only
// codebase-memory-mcp (cbm) graph context for SessionStart, SubagentStart,
// PreToolUse(Grep|Glob) and PostToolUse(Read). One file backs all four hooks.json
// registrations, dispatching on hook_event_name.
//
// Contract: this hook emits ONLY hookSpecificOutput.{hookEventName,additionalContext}.
// It never emits permissionDecision, updatedInput, updatedToolOutput, decision,
// continue or stopReason, and never exits 2 — the observed tool call always proceeds
// untouched. Every failure path is a bare `return` inside main()'s single try/catch
// (never process.exit), matching rtk-rewrite.mjs.
//
// Every cbm invocation goes through bin/cbm-launch.sh with CBM_NO_EXTRACT=1, so a hook
// can never trigger the ~280 MiB extraction: a cold cache means silence. Only read-only
// cbm tools are called (list_projects, index_status, search_graph, check_index_coverage).
import process from "node:process";
import path from "node:path";

/** Hard cap on injected context per event — well under the 10 000-char hook-output cap. */
export const CONTEXT_CHAR_LIMIT = 1500;
/** Maximum graph symbols quoted into a PreToolUse context block. */
export const SYMBOL_LIMIT = 10;
/** Longest Grep/Glob pattern still worth a graph lookup. */
export const PATTERN_CHAR_LIMIT = 200;
/** Same stdin cap as coding-toolbox/hooks/encoding-guard.mjs. */
export const STDIN_CAP = 1024 * 1024;
/** Stays well under hooks.json's timeout: 10. */
export const CBM_SPAWN_TIMEOUT_MS = 5000;
/** spawnSync's default, pinned explicitly. */
export const CBM_MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * First non-empty string value among the given keys, trimmed.
 * @param {Record<string, unknown>} rec
 * @param {string[]} keys
 * @returns {string|null}
 */
function firstString(rec, keys) {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * First finite number value among the given keys.
 * @param {Record<string, unknown>} rec
 * @param {string[]} keys
 * @returns {number|null}
 */
function firstNumber(rec, keys) {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Peel the common result envelopes cbm may wrap a payload in. Bounded to 4 levels.
 * @param {unknown} payload
 * @returns {unknown}
 */
function unwrap(payload) {
  let current = payload;
  for (let depth = 0; depth < 4; depth += 1) {
    const rec = asRecord(current);
    if (rec === null) return current;
    const next = rec.result ?? rec.data ?? rec.payload;
    if (next === undefined) return current;
    current = next;
  }
  return current;
}

/**
 * The first array found at the payload root or under one of the given keys.
 * @param {unknown} payload
 * @param {string[]} keys
 * @returns {unknown[]}
 */
function collectArray(payload, keys) {
  const root = unwrap(payload);
  if (Array.isArray(root)) return root;
  const rec = asRecord(root);
  if (rec === null) return [];
  for (const key of keys) {
    const value = rec[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

/**
 * @param {string} text
 * @returns {string}
 */
function truncate(text) {
  const trimmed = text.trim();
  return trimmed.length <= CONTEXT_CHAR_LIMIT ? trimmed : `${trimmed.slice(0, CONTEXT_CHAR_LIMIT - 1)}…`;
}

/**
 * Is `target` the same directory as `base`, or below it?
 * @param {string} base
 * @param {string} target
 * @returns {boolean}
 */
function isSameOrAncestor(base, target) {
  const b = path.resolve(base);
  const t = path.resolve(target);
  return t === b || t.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}

/**
 * A string is usable as a filesystem path only when non-empty and free of an
 * uninterpolated `${` — a literal placeholder must never create a directory.
 * @param {string|undefined} value
 * @returns {boolean}
 */
function usablePath(value) {
  return typeof value === "string" && value.trim() !== "" && !value.includes("${");
}

/**
 * userConfig toggle read (CLAUDE_PLUGIN_OPTION_CBM_ENABLED), fail-open: unset, empty,
 * "true", "FALSE" and an uninterpolated `${user_config.cbm_enabled}` placeholder all
 * count as enabled; only the trimmed literal "false" disables.
 * @param {string|undefined} value
 * @returns {boolean}
 */
export function isCbmEnabled(value) {
  return String(value ?? "").trim() !== "false";
}

/**
 * The extraction-cache root handed to bin/cbm-launch.sh. Mirrors the launcher's own
 * rules; never returns a path containing a literal `${`.
 * @param {Record<string, string|undefined>} env
 * @returns {string}
 */
export function resolveBundleCache(env) {
  if (usablePath(env.CBM_BUNDLE_CACHE)) return String(env.CBM_BUNDLE_CACHE).trim();
  if (usablePath(env.CLAUDE_PLUGIN_DATA)) return path.join(String(env.CLAUDE_PLUGIN_DATA).trim(), "cbm");
  const tmp = usablePath(env.TMPDIR) ? String(env.TMPDIR).trim() : "/tmp";
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return path.join(tmp, `claude-cbm-${uid}`);
}

/**
 * The graph project whose recorded repo path equals, or is the nearest ancestor of,
 * `cwd`. null when the payload is unrecognized or nothing matches — never guessed.
 * @param {unknown} payload
 * @param {string} cwd
 * @returns {string|null}
 */
export function pickProject(payload, cwd) {
  if (typeof cwd !== "string" || cwd.trim() === "") return null;
  /** @type {{name: string, root: string}|null} */
  let best = null;
  for (const item of collectArray(payload, ["projects", "items", "entries"])) {
    const rec = asRecord(item);
    if (rec === null) continue;
    const name = firstString(rec, ["name", "project", "project_name", "projectName", "id"]);
    const root = firstString(rec, ["path", "root", "repo_path", "repoPath", "root_path", "rootPath", "directory"]);
    if (name === null || root === null) continue;
    if (!isSameOrAncestor(root, cwd)) continue;
    if (best === null || path.resolve(root).length > path.resolve(best.root).length) best = { name, root };
  }
  return best === null ? null : best.name;
}

/**
 * The read-only search_graph query a Grep/Glob call maps to: Grep's pattern is a symbol
 * name pattern, Glob's is a file pattern. null for any other tool, a missing, blank or
 * over-long pattern — no graph call is worth making then.
 * @param {string} toolName
 * @param {unknown} toolInput
 * @returns {{flag: string, value: string}|null}
 */
export function graphQueryFromToolInput(toolName, toolInput) {
  const flag = toolName === "Grep" ? "--name-pattern" : toolName === "Glob" ? "--file-pattern" : null;
  if (flag === null) return null;
  const rec = asRecord(toolInput);
  if (rec === null) return null;
  const value = firstString(rec, ["pattern"]);
  if (value === null || value.length > PATTERN_CHAR_LIMIT) return null;
  return { flag, value };
}

/**
 * Human-readable index state, or null when the payload says nothing recognizable.
 * @param {unknown} payload
 * @returns {string|null}
 */
function describeIndexStatus(payload) {
  const rec = asRecord(unwrap(payload));
  if (rec === null) return null;
  /** @type {string[]} */
  const parts = [];
  const state = firstString(rec, ["status", "state", "index_status", "indexStatus"]);
  if (state !== null) parts.push(`index ${state}`);
  const files = firstNumber(rec, ["files", "file_count", "fileCount", "indexed_files", "indexedFiles"]);
  if (files !== null) parts.push(`${files} indexed files`);
  const symbols = firstNumber(rec, ["symbols", "symbol_count", "symbolCount"]);
  if (symbols !== null) parts.push(`${symbols} symbols`);
  if (rec.stale === true || rec.is_stale === true || rec.isStale === true) parts.push("index stale");
  const last = firstString(rec, ["last_indexed", "lastIndexed", "updated_at", "updatedAt"]);
  if (last !== null) parts.push(`last indexed ${last}`);
  return parts.length === 0 ? null : parts.join(", ");
}

/**
 * SessionStart context: project, index freshness, and the steer towards the graph tools.
 * @param {string} project
 * @param {unknown} statusJson
 * @returns {string|null}
 */
export function formatSessionContext(project, statusJson) {
  if (typeof project !== "string" || project.trim() === "") return null;
  const state = describeIndexStatus(statusJson);
  const suffix = state === null ? "" : ` (${state})`;
  return truncate(
    `codebase-memory graph project "${project.trim()}" covers this repository${suffix}. ` +
      "Prefer the mcp__codebase-memory__* graph tools (search_graph, get_symbol, list_symbols) over plain text search " +
      "when locating symbols, definitions or callers here.",
  );
}

/**
 * SubagentStart context: the same facts, shorter, plus the delegation instruction.
 * @param {string} project
 * @param {unknown} statusJson
 * @returns {string|null}
 */
export function formatSubagentContext(project, statusJson) {
  if (typeof project !== "string" || project.trim() === "") return null;
  const state = describeIndexStatus(statusJson);
  const suffix = state === null ? "" : ` (${state})`;
  return truncate(`codebase-memory graph project "${project.trim()}"${suffix}. ` + "Pass qualified symbol names and file paths through when delegating further.");
}

/**
 * PreToolUse context: at most `limit` qualified symbols with their files.
 * @param {unknown} payload
 * @param {number} limit
 * @returns {string|null}
 */
export function formatSymbolContext(payload, limit) {
  const max = typeof limit === "number" && limit > 0 ? Math.floor(limit) : SYMBOL_LIMIT;
  /** @type {string[]} */
  const lines = [];
  for (const item of collectArray(payload, ["results", "symbols", "matches", "nodes", "items"])) {
    if (lines.length >= max) break;
    const rec = asRecord(item);
    if (rec === null) continue;
    const name = firstString(rec, ["qualified_name", "qualifiedName", "fqn", "name", "symbol"]);
    if (name === null) continue;
    const file = firstString(rec, ["file", "path", "file_path", "filePath", "location"]);
    const line = firstNumber(rec, ["line", "start_line", "startLine", "lineno"]);
    const where = file === null ? "" : ` — ${file}${line === null ? "" : `:${line}`}`;
    lines.push(`- ${name}${where}`);
  }
  if (lines.length === 0) return null;
  return truncate(["codebase-memory graph matches for this search:", ...lines, "Use mcp__codebase-memory__* on these qualified names instead of widening the text search."].join("\n"));
}

/**
 * PostToolUse context: a warning ONLY when the coverage payload reports the file as
 * skipped, excluded or partially parsed. A clean or unrecognized result is silence.
 * @param {unknown} payload
 * @param {string} filePath
 * @returns {string|null}
 */
export function formatCoverageContext(payload, filePath) {
  if (typeof filePath !== "string" || filePath.trim() === "") return null;
  const rec = asRecord(unwrap(payload));
  if (rec === null) return null;
  /** @type {string[]} */
  const flagged = [];
  for (const key of ["skipped", "excluded", "partial", "partially_parsed", "partiallyParsed", "unsupported", "truncated"]) {
    if (rec[key] === true) flagged.push(key.replace(/_/g, " "));
  }
  if (rec.indexed === false || rec.covered === false) flagged.push("not indexed");
  const state = firstString(rec, ["status", "state", "coverage", "coverage_status", "reason", "parse_error", "error"]);
  if (state !== null && /skip|exclud|partial|unsupported|error|missing|not[ _-]?indexed/i.test(state)) flagged.push(state);
  if (flagged.length === 0) return null;
  return truncate(
    `codebase-memory graph coverage warning for ${filePath.trim()}: ${flagged.join("; ")}. ` +
      "The graph's view of this file is incomplete — rely on the file's own contents rather than on graph results for it.",
  );
}

/**
 * The ONLY output shape this hook ever writes.
 * @param {string} hookEventName
 * @param {string} additionalContext
 * @returns {HookResult}
 */
export function buildOutput(hookEventName, additionalContext) {
  /** @type {HookSpecificOutput} */
  const hookSpecificOutput = { hookEventName, additionalContext };
  return { hookSpecificOutput };
}
