// mcp/cbm-context.mjs — linux-token-efficiency: pure helpers for the cbm proxy MCP
// server (mcp/server.mjs). Imported, never executed: no shebang (mode 100644), no
// main(), no spawn, no stdin, no process.exit.
//
// Contract: every formatter returns a non-empty context string or null ("nothing to
// say"); nothing here writes to stdout. Payload shapes were read off the pinned
// codebase-memory-mcp v0.10.1 binary directly:
//   * every tools/call result is {content:[{type:"text",text:"<json>"}],isError:bool}
//     and sometimes carries a parallel structuredContent -> unwrapToolResult().
//   * search_graph with format:"json" returns {total,count,cols,groups:[{qn_prefix,
//     file,rows:[[…]]}],has_more} -> formatSymbolContext().
//   * check_index_coverage takes paths:[…] and returns {…,paths:[{requested_path,path,
//     coverage_lookup,status,freshness,recommended_action,coverage:[]}],…}
//     -> formatCoverageContext().
// An unrecognized payload is always silence, never a guess.
import process from "node:process";
import path from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

/** Hard cap on injected context per event — well under the 10 000-char hook-output cap. */
export const CONTEXT_CHAR_LIMIT = 1500;
/** Maximum graph symbols quoted into a PreToolUse context block. */
export const SYMBOL_LIMIT = 10;
/** Longest Grep/Glob pattern still worth a graph lookup. */
export const PATTERN_CHAR_LIMIT = 200;
/**
 * How long a resolved cwd -> project mapping is trusted before re-running list_projects.
 * The mapping is stable within a session (per-cwd repo root doesn't move) but a fresh
 * `index_repository` can add a project cbm previously didn't know about, so this bounds
 * staleness rather than caching forever.
 */
export const PROJECT_CACHE_TTL_MS = 10 * 60 * 1000;

/** Coverage states worth warning about. `coverage_unavailable` is handled earlier (silence). */
const COVERAGE_GAP_RE = /not[_ -]?indexed|skipped|exclud|partial|unsupported|stale|source_newer|reindex/i;

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
 * Peel the common inner envelopes a payload may still be wrapped in. Bounded to 4 levels.
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
  if (trimmed.length <= CONTEXT_CHAR_LIMIT) return trimmed;
  let cut = CONTEXT_CHAR_LIMIT - 1;
  // Never split a UTF-16 surrogate pair: back off one unit if the slice would end on
  // a leading (high) surrogate with its trailing (low) surrogate just past the cut.
  if (cut > 0) {
    const code = trimmed.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  }
  return `${trimmed.slice(0, cut)}…`;
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
 * The plugin's own extraction-cache root (never cbm's CBM_CACHE_DIR graph root).
 * Never returns a path containing a literal `${`.
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
 * Directory holding one small JSON file per resolved cwd -> project mapping. A subdir of
 * the same extraction-cache root the server writes to (never a new root).
 * @param {Record<string, string|undefined>} env
 * @returns {string}
 */
export function resolveProjectCacheDir(env) {
  return path.join(resolveBundleCache(env), "project-cache");
}

/**
 * Stable, filesystem-safe filename for a cwd — sha256 keeps it short and collision-free
 * regardless of path length or characters.
 * @param {string} cwd
 * @returns {string}
 */
export function projectCacheKey(cwd) {
  return createHash("sha256").update(cwd).digest("hex");
}

/**
 * Read a still-fresh cached {name, root} project entry for `cwd`. Returns null on a miss,
 * an expired entry, a pre-rework entry without a recorded root, or ANY read/parse error —
 * a corrupt or absent cache is always just a miss.
 * @param {string} cacheDir
 * @param {string} cwd
 * @returns {{name: string, root: string}|null}
 */
export function readProjectCache(cacheDir, cwd) {
  try {
    const raw = readFileSync(path.join(cacheDir, `${projectCacheKey(cwd)}.json`), "utf8");
    const rec = asRecord(JSON.parse(raw));
    if (rec === null) return null;
    const name = firstString(rec, ["project"]);
    const root = firstString(rec, ["root"]);
    const cachedAt = firstNumber(rec, ["cachedAt"]);
    if (name === null || root === null || cachedAt === null) return null;
    if (Date.now() - cachedAt > PROJECT_CACHE_TTL_MS) return null;
    return { name, root };
  } catch {
    return null;
  }
}

/**
 * Best-effort cache write. Writes to a per-process temp file then renames into place
 * (atomic on the same filesystem) so a concurrent reader never sees a partial write.
 * Any failure (missing dir, no permissions, race) is swallowed — the cache is purely an
 * optimization, never a dependency.
 * @param {string} cacheDir
 * @param {string} cwd
 * @param {{name: string, root: string}} entry
 * @returns {void}
 */
export function writeProjectCache(cacheDir, cwd, entry) {
  try {
    const rec = asRecord(entry);
    if (rec === null) return;
    const name = firstString(rec, ["name"]);
    const root = firstString(rec, ["root"]);
    if (name === null || root === null) return;
    mkdirSync(cacheDir, { recursive: true });
    const key = projectCacheKey(cwd);
    const tmp = path.join(cacheDir, `.${key}.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify({ project: name, root, cachedAt: Date.now() }), "utf8");
    renameSync(tmp, path.join(cacheDir, `${key}.json`));
  } catch {
    // best-effort — a failed cache write never blocks context injection
  }
}

/**
 * Peel cbm's MCP tool-result envelope: structuredContent when present, else
 * JSON.parse(content[0].text). null on isError, a non-object result, a missing text
 * part, or unparsable text.
 * @param {unknown} result
 * @returns {unknown}
 */
export function unwrapToolResult(result) {
  const rec = asRecord(result);
  if (rec === null) return null;
  if (rec.isError === true) return null;
  const structured = rec.structuredContent;
  if (structured !== undefined && (Array.isArray(structured) || asRecord(structured) !== null)) return structured;
  const content = Array.isArray(rec.content) ? rec.content : [];
  const first = asRecord(content[0]);
  if (first === null) return null;
  const text = typeof first.text === "string" ? first.text : null;
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The graph project whose recorded repo path equals, or is the nearest ancestor of,
 * `cwd`, with that recorded path. null when the payload is unrecognized or nothing
 * matches — never guessed.
 * @param {unknown} payload
 * @param {string} cwd
 * @returns {{name: string, root: string}|null}
 */
export function pickProjectEntry(payload, cwd) {
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
  return best;
}

/**
 * The matched project's name only — a thin wrapper over pickProjectEntry.
 * @param {unknown} payload
 * @param {string} cwd
 * @returns {string|null}
 */
export function pickProject(payload, cwd) {
  const entry = pickProjectEntry(payload, cwd);
  return entry === null ? null : entry.name;
}

/**
 * The read-only search_graph query a Grep/Glob call maps to, as MCP argument names (not
 * CLI flags): Grep's pattern is a symbol name pattern, Glob's is a file pattern. null for
 * any other tool, a missing, blank or over-long pattern — no graph call is worth making.
 * @param {string} toolName
 * @param {unknown} toolInput
 * @returns {{arg: string, value: string}|null}
 */
export function graphQueryFromToolInput(toolName, toolInput) {
  const arg = toolName === "Grep" ? "name_pattern" : toolName === "Glob" ? "file_pattern" : null;
  if (arg === null) return null;
  const rec = asRecord(toolInput);
  if (rec === null) return null;
  const value = firstString(rec, ["pattern"]);
  if (value === null || value.length > PATTERN_CHAR_LIMIT) return null;
  return { arg, value };
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
 * Shared shape for SessionStart/SubagentStart context: project name, index freshness,
 * and a caller-supplied head clause + tail instruction. null on a blank project.
 * @param {string} project
 * @param {unknown} statusJson
 * @param {string} headClause
 * @param {string} tailSentence
 * @returns {string|null}
 */
function formatProjectContext(project, statusJson, headClause, tailSentence) {
  if (typeof project !== "string" || project.trim() === "") return null;
  const state = describeIndexStatus(statusJson);
  const suffix = state === null ? "" : ` (${state})`;
  return truncate(`codebase-memory graph project "${project.trim()}"${headClause}${suffix}. ${tailSentence}`);
}

/**
 * SessionStart context: project, index freshness, and the steer towards the graph tools.
 * @param {string} project
 * @param {unknown} statusJson
 * @returns {string|null}
 */
export function formatSessionContext(project, statusJson) {
  return formatProjectContext(
    project,
    statusJson,
    " covers this repository",
    "Prefer the mcp__codebase-memory__* graph tools over plain text search when locating symbols, definitions or callers here.",
  );
}

/**
 * SubagentStart context: the same facts, shorter, plus the delegation instruction.
 * @param {string} project
 * @param {unknown} statusJson
 * @returns {string|null}
 */
export function formatSubagentContext(project, statusJson) {
  return formatProjectContext(project, statusJson, "", "Pass qualified symbol names and file paths through when delegating further.");
}

/**
 * The first line number mentioned by a search_graph `lines` cell (a number, a "12-40"
 * range string, or an array), rendered as ":<n>". "" when there is nothing to render.
 * @param {unknown} value
 * @returns {string}
 */
function firstLineSuffix(value) {
  if (typeof value === "number" && Number.isFinite(value)) return `:${Math.trunc(value)}`;
  if (Array.isArray(value)) {
    const found = value.find((v) => typeof v === "number" && Number.isFinite(v));
    return found === undefined ? "" : `:${Math.trunc(/** @type {number} */ (found))}`;
  }
  if (typeof value === "string") {
    const match = value.match(/\d+/);
    return match === null ? "" : `:${match[0]}`;
  }
  return "";
}

/**
 * PreToolUse context: at most `limit` qualified symbols with their files, read out of
 * search_graph's format:"json" model {total,count,cols,groups:[{qn_prefix,file,rows}]}.
 * The column indices come from `cols`; an unrecognized payload is silence.
 * @param {unknown} payload
 * @param {number} limit
 * @returns {string|null}
 */
export function formatSymbolContext(payload, limit) {
  const max = typeof limit === "number" && limit > 0 ? Math.floor(limit) : SYMBOL_LIMIT;
  const rec = asRecord(unwrap(payload));
  if (rec === null) return null;
  const cols = (Array.isArray(rec.cols) ? rec.cols : []).map((c) => (typeof c === "string" ? c : ""));
  const nameIdx = cols.indexOf("name");
  const linesIdx = cols.indexOf("lines");
  if (nameIdx < 0) return null;
  /** @type {string[]} */
  const lines = [];
  for (const group of Array.isArray(rec.groups) ? rec.groups : []) {
    if (lines.length >= max) break;
    const g = asRecord(group);
    if (g === null) continue;
    const prefix = typeof g.qn_prefix === "string" ? g.qn_prefix : "";
    const file = typeof g.file === "string" ? g.file.trim() : "";
    for (const row of Array.isArray(g.rows) ? g.rows : []) {
      if (lines.length >= max) break;
      if (!Array.isArray(row)) continue;
      const raw = row[nameIdx];
      const name = typeof raw === "string" ? raw.trim() : "";
      if (name === "") continue;
      const where = file === "" ? "" : ` — ${file}${linesIdx < 0 ? "" : firstLineSuffix(row[linesIdx])}`;
      lines.push(`- ${prefix}${name}${where}`);
    }
  }
  if (lines.length === 0) return null;
  return truncate(["codebase-memory graph matches for this search:", ...lines, "Use mcp__codebase-memory__* on these qualified names instead of widening the text search."].join("\n"));
}

/**
 * PostToolUse context: a warning ONLY when check_index_coverage's paths[] entry for
 * `filePath` reports a real gap. A missing entry, an errored/unavailable lookup, a clean
 * entry or an unrecognized payload are all silence — no signal is not evidence of a gap.
 * @param {unknown} payload
 * @param {string} filePath
 * @returns {string|null}
 */
export function formatCoverageContext(payload, filePath) {
  if (typeof filePath !== "string" || filePath.trim() === "") return null;
  const rec = asRecord(unwrap(payload));
  if (rec === null) return null;
  const wanted = filePath.trim();
  /** @type {Record<string, unknown>|null} */
  let entry = null;
  for (const item of Array.isArray(rec.paths) ? rec.paths : []) {
    const candidate = asRecord(item);
    if (candidate === null) continue;
    const requested = typeof candidate.requested_path === "string" ? candidate.requested_path.trim() : "";
    const resolved = typeof candidate.path === "string" ? candidate.path.trim() : "";
    if (requested === wanted || resolved === wanted) {
      entry = candidate;
      break;
    }
  }
  if (entry === null) return null;
  // No signal first: a repo without recorded coverage must not warn on every Read.
  if (entry.coverage_lookup === "error" || entry.status === "coverage_unavailable") return null;
  /** @type {string[]} */
  const flagged = [];
  for (const key of ["status", "freshness", "recommended_action"]) {
    const value = entry[key];
    if (typeof value === "string" && COVERAGE_GAP_RE.test(value)) flagged.push(value.trim());
  }
  if (entry.indexed === false || entry.covered === false) flagged.push("not indexed");
  if (flagged.length === 0) return null;
  return truncate(
    `codebase-memory graph coverage warning for ${wanted}: ${flagged.join("; ")}. ` +
      "The graph's view of this file is incomplete — rely on the file's own contents rather than on graph results for it.",
  );
}

/**
 * `filePath` relative to a project root, or null when it lies outside that root.
 * "." for the root itself.
 * @param {string} root
 * @param {string} filePath
 * @returns {string|null}
 */
export function relativeToProject(root, filePath) {
  if (typeof root !== "string" || root.trim() === "") return null;
  if (typeof filePath !== "string" || filePath.trim() === "") return null;
  const base = path.resolve(root.trim());
  const target = path.resolve(filePath.trim());
  if (!isSameOrAncestor(base, target)) return null;
  const rel = path.relative(base, target);
  return rel === "" ? "." : rel;
}

/**
 * The ONLY output shape the four hook tools ever return besides `{}`.
 * @param {string} hookEventName
 * @param {string} additionalContext
 * @returns {HookResult}
 */
export function buildOutput(hookEventName, additionalContext) {
  /** @type {HookSpecificOutput} */
  const hookSpecificOutput = { hookEventName, additionalContext };
  return { hookSpecificOutput };
}
