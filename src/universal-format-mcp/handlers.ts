// handlers.ts — the two hook handlers plus their pure helpers. Fail open is the contract: every
// guard failure and every caught error returns {}. The TS port must never "tighten" that away
// because a type says a value cannot be undefined.
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { EXT_MAP, PRETTIER_LANGS, REGISTRY, selectFormatter } from "./registry.js";
import { walkToRoot } from "./util.js";
import { PRETTIER_CONFIG_FILENAMES, clearPrettierConfigCaches, clearPrettierIgnoreCache, formatInProcess, isPrettierIgnored, primePrettierIgnoreCache, warmPrettierConfigCache } from "./prettier.js";

const SPAWN_TIMEOUT_MS = 30000; // inner formatter timeout; the hook-level timeout:60 is the backstop

// Promise-based, not spawnSync: this handler runs inside a persistent MCP server that also
// services other concurrent hook calls, so a blocking spawn would stall the whole event loop
// (and every other in-flight format_pre/format_post) for up to SPAWN_TIMEOUT_MS.
const execFile = promisify(execFileCb);

// True when `rel` (already resolved inside cwd) is dependency/VCS state (node_modules/vendor/
// .git) or Claude-Code-owned session/worktree machinery that happens to sit inside cwd -- a
// nested git worktree (.claude/worktrees/…) or an agent's local runtime scratch state
// (.claude/agent-memory/…) is never real project content, so it's skipped the same way
// node_modules is. This repo's own tracked .claude/rules|agents|skills stay covered -- only these
// two specific subtrees are Claude-Code-internal, not `.claude/` as a whole. `*.local.*`
// (personal local-override files, e.g. settings.local.json) is skipped regardless of location.
export function isExcludedPath(rel: string): boolean {
  const segments = rel.split(path.sep);
  if (segments.some((s) => s === "node_modules" || s === "vendor" || s === ".git")) return true;
  if (segments.some((s, i) => s === ".claude" && (segments[i + 1] === "worktrees" || segments[i + 1] === "agent-memory"))) return true;
  return segments[segments.length - 1].includes(".local.");
}

/** True when `resolved` is `dir` itself or lives underneath it. `path.relative` is the
 * containment test on purpose: the older
 * `resolved !== dir && !resolved.startsWith(dir + path.sep)` form answered "no" for EVERY file
 * when `dir` carried a trailing separator or was `/`. Do not "simplify" it back. */
function contains(dir: string, resolved: string): boolean {
  const rel = path.relative(dir, resolved);
  return rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

/** The directory every project-scoped lookup for `resolved` anchors at: its `.prettierignore`, its
 * prettier `plugins:` resolution, the upper bound of the .editorconfig / tool-native-config walks,
 * and the formatter subprocess's own cwd. The session's `cwd` when it really contains the file
 * (unchanged behavior for the normal case, and the ONLY case whose ignore/config resolution this
 * plugin has ever promised); otherwise the file's own git root -- `.git` is existence-checked, not
 * stat'd as a directory, because a worktree's and a submodule's `.git` is a FILE; otherwise the
 * file's own directory. `cwd` is a hint here, never a gate: a file outside `cwd` is formatted
 * against its own project instead of being skipped. Always returns an ancestor-or-equal directory
 * of `resolved`, so the caller's `path.relative(base, resolved)` never escapes with `..` and both
 * bounded upward walks terminate at `base` as intended. */
export function resolveBase(cwd: string, resolved: string): string {
  if (cwd && contains(cwd, resolved)) return cwd;
  const fileDir = path.dirname(resolved);
  let found = "";
  walkToRoot(fileDir, (dir) => {
    if (!existsSync(path.join(dir, ".git"))) return false;
    found = dir;
    return true;
  });
  return found || fileDir;
}

// Per-agent override of "the real current cwd", raised only by worktreeEntered
// (PostToolUse:EnterWorktree). CwdChanged is wired for the same purpose but has been observed
// (live session transcript, no CwdChanged event at all across a real EnterWorktree call) to
// never fire when EnterWorktree switches a background-job session into a worktree -- so `cwd` on
// every later PreToolUse/PostToolUse Write|Edit call keeps reporting the pre-worktree directory,
// isExcludedPath then misclassifies the session's OWN active worktree as another agent's scratch
// state (the very thing that exclusion is meant to skip), and formatting silently stops for the
// rest of the session. This override is the fallback that actually fires.
//
// Keyed by agent_id (falling back to session_id for the main/non-subagent conversation), exactly
// like ignoreCache/projectConfigCache in prettier.ts are keyed by cwd, and for the same reason
// their own comment states: "concurrent in-flight hook calls from sub-agents may carry different
// cwds against this one long-lived server process." A bare global here would let one concurrently
// running subagent's EnterWorktree clobber the cwd every OTHER subagent's format_pre/format_post
// resolves against -- cross-contaminating which worktree a file gets formatted relative to.
const cwdOverrides = new Map<string, string>();

/** The key `cwdOverrides` is keyed by for this hook call, or "" if neither field is present
 * (resolveCwd then falls through to `args.cwd` untouched, same as before this override existed). */
function overrideKey(args: { agent_id?: unknown; session_id?: unknown }): string {
  if (typeof args?.agent_id === "string" && args.agent_id) return args.agent_id;
  return typeof args?.session_id === "string" ? args.session_id : "";
}

/** `args.cwd`, unless worktreeEntered has raised an override for THIS agent/session. */
function resolveCwd(args: { cwd?: unknown; agent_id?: unknown; session_id?: unknown }): string {
  const key = overrideKey(args);
  const override = key ? cwdOverrides.get(key) : undefined;
  if (override) return override;
  return typeof args?.cwd === "string" ? args.cwd : "";
}

/** Apply an Edit in memory (mirrors Claude Code Edit semantics): the whole-file swap must never
 * mask a not-found/non-unique error. An empty `oldStr` is rejected outright — `"".includes` /
 * `indexOf("")` both "match", and the replace_all branch would splice `newStr` between every
 * character of the file and hand that back as updatedInput. */
export function applyEdit(current: string, oldStr: string, newStr: string, replaceAll: boolean): string | null {
  if (oldStr === "") return null;
  if (replaceAll) return current.includes(oldStr) ? current.split(oldStr).join(newStr) : null;
  const idx = current.indexOf(oldStr);
  if (idx === -1) return null;
  if (current.indexOf(oldStr, idx + oldStr.length) !== -1) return null; // non-unique
  return current.slice(0, idx) + newStr + current.slice(idx + oldStr.length);
}

// The two cwd-rooted ignore files. A write to either one refreshes THIS server's cwd-keyed
// ignore cache (prettier's own getFileInfo still caches nothing). Kept as its own set so
// formatPost can act on it separately from the config clear.
export const PRETTIER_IGNORE_BASENAMES: Set<string> = new Set([".prettierignore", ".gitignore"]);

// Basenames whose write invalidates prettier's cached configuration. The prettier config files
// themselves, the two files prettier reads a top-level "prettier" key out of, and .editorconfig
// (a SEPARATE cache inside prettier from .prettierrc -- verified that clearConfigCache() covers
// both). The two ignore files are spread in so this set stays the single "a config-ish file was
// written" concept; clearing prettier's config cache for them really is inert, but they are NOT
// inert overall -- the second line of formatPost's basename block re-reads the ignore cache for
// them. Membership is unchanged from before that second line existed.
export const CACHE_INVALIDATING_BASENAMES: Set<string> = new Set([...PRETTIER_CONFIG_FILENAMES, "package.json", "package.yaml", ".editorconfig", ...PRETTIER_IGNORE_BASENAMES]);

/** PostToolUse handler: the non-prettier CLI chains only, plus the event-driven prettier
 * config-cache invalidation. Returns {} on every guard failure / error (fail open). */
export async function formatPost(args: PostToolUseHookInput): Promise<HookResult> {
  try {
    if (args?.tool_response?.success === false) return {};
    const cwd = resolveCwd(args);
    const fp = args?.tool_input?.file_path;
    if (typeof fp !== "string" || !fp) return {};
    if (!cwd && !path.isAbsolute(fp)) return {}; // nothing to resolve a relative path against

    const resolved = path.resolve(cwd, fp);
    const base = resolveBase(cwd, resolved);
    const rel = path.relative(base, resolved);
    if (isExcludedPath(rel)) return {};

    // The write has landed by now, so this is the only correct moment to invalidate/refresh. Runs
    // BEFORE the language guard on purpose: most of these basenames have no extension at all
    // (`.prettierrc`, `.editorconfig`, `.prettierignore`), so EXT_MAP would drop them and neither
    // cache would ever be touched. primePrettierIgnoreCache always re-reads the BASE-ROOTED ignore
    // files, so a write to a nested `sub/.prettierignore` triggers a harmless (and correct)
    // re-read of the base-rooted ones rather than mistaking the written file for the cached one.
    const basename = path.basename(resolved);
    if (CACHE_INVALIDATING_BASENAMES.has(basename)) clearPrettierConfigCaches();
    if (PRETTIER_IGNORE_BASENAMES.has(basename)) primePrettierIgnoreCache(base);

    const lang = EXT_MAP[path.extname(resolved).toLowerCase()];
    if (!lang) return {};
    if (!existsSync(resolved)) return {};

    // format_pre owns every prettier language, before the write, with the bundled prettier.
    if (PRETTIER_LANGS.has(lang)) return {};

    // EXT_MAP/REGISTRY drift guard: EXT_MAP maps thirteen languages REGISTRY no longer contains,
    // so an unguarded REGISTRY[lang].chain would throw if the PRETTIER_LANGS return were ever
    // reordered away. Pinned by registry.test.mjs's EXT_MAP-partition tripwire.
    const entry = REGISTRY[lang];
    if (!entry) return {};

    const selection = selectFormatter(entry.chain, resolved, base);
    if (!selection) return {};
    const { tool, argv } = selection;

    const before = readFileSync(resolved);
    try {
      await execFile(tool.name, [...argv, resolved], { cwd: base, timeout: SPAWN_TIMEOUT_MS });
    } catch {
      /* spawn/non-zero-exit failure is a silent no-op -- some tools (ktlint) exit non-zero after
       * a successful format, so this must never gate the before/after diff below */
    }
    const after = readFileSync(resolved);
    if (before.equals(after)) return {};

    // A repo-relative path alone is ambiguous once files from several projects can be formatted in
    // one session, so only an in-cwd file (base === cwd) keeps the short form; everything else is
    // named absolutely. In-cwd notices stay byte-identical to before.
    const display = base === cwd ? rel : resolved;
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `universal-format: ${tool.name} reformatted ${display}; re-read it before further string-based edits. This reformat is intentional and exempt from "surgical/minimal-diff" change-scope rules — do not revert or redo it by hand to shrink the diff.`,
      },
    };
  } catch {
    return {};
  }
}

/** PreToolUse handler: every prettier language formatted in-process before the write via
 * updatedInput with the bundled prettier. Never sets permissionDecision. Returns {} on every
 * guard failure / error (fail open). */
export async function formatPre(args: ToolHookInput): Promise<HookResult> {
  try {
    const cwd = resolveCwd(args);
    const fp = args?.tool_input?.file_path;
    if (typeof fp !== "string" || !fp) return {};
    if (!cwd && !path.isAbsolute(fp)) return {}; // nothing to resolve a relative path against

    const resolved = path.resolve(cwd, fp);
    const base = resolveBase(cwd, resolved);
    const rel = path.relative(base, resolved);
    if (isExcludedPath(rel)) return {};

    const lang = EXT_MAP[path.extname(resolved).toLowerCase()];
    if (!lang || !PRETTIER_LANGS.has(lang)) return {};

    if (await isPrettierIgnored(resolved, base)) return {};

    const display = base === cwd ? rel : resolved;
    const notice = `universal-format: prettier reformatted ${display}; re-read it before further string-based edits. This reformat is intentional and exempt from "surgical/minimal-diff" change-scope rules — do not revert or redo it by hand to shrink the diff.`;

    if (args.tool_name === "Write") {
      const content = args.tool_input.content;
      if (typeof content !== "string") return {};
      const formatted = await formatInProcess(content, resolved, base, lang);
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
      const formatted = await formatInProcess(merged, resolved, base, lang);
      if (formatted === merged) return {};
      return { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { file_path: fp, old_string: current, new_string: formatted, replace_all: false }, additionalContext: notice } };
    }

    return {};
  } catch {
    return {};
  }
}

/** CwdChanged handler: the session's working directory moved, so drop the OLD directory's ignore
 * entry and prefetch both halves for the NEW one — its cwd-rooted ignore files, and prettier's
 * own directory-keyed config-search cache (measured ~1.9 ms -> ~0.25 ms for the first format
 * there). A `cd` is not a format, so this really is a prefetch and not a cost shift. Also raises
 * this call's `cwdOverrides` entry to `newCwd`, same as worktreeEntered, so this stays
 * authoritative if a real CwdChanged ever does fire after a worktreeEntered-raised override (e.g.
 * a plain `cd` later in the same agent/session). Per .claude/rules/hooks-mcp-tool-event-matrix.md
 * CwdChanged is block_capable:false, additional_context:false, block_mechanism:"none" — there is
 * nothing useful to say, so it always returns {}. Each half is independently guarded so a
 * missing/non-string field is simply skipped. */
export async function cwdChanged(args: CwdChangedHookInput): Promise<HookResult> {
  try {
    const oldCwd = typeof args?.old_cwd === "string" ? args.old_cwd : "";
    const newCwd = typeof args?.new_cwd === "string" ? args.new_cwd : "";
    if (oldCwd) clearPrettierIgnoreCache(oldCwd);
    if (newCwd) {
      const key = overrideKey(args);
      if (key) cwdOverrides.set(key, newCwd);
      primePrettierIgnoreCache(newCwd);
      await warmPrettierConfigCache(newCwd);
    }
  } catch {
    /* fail open: a cache prefetch must never surface as a hook failure */
  }
  return {};
}

/** PostToolUse:EnterWorktree handler: the one signal that has actually been observed to fire when
 * a background-job session's cwd moves into a worktree, since the dedicated CwdChanged event does
 * not (see cwdOverrides' comment). `tool_response.worktreePath` is EnterWorktree's own reported
 * path — the same field coding-toolbox's worktreeRefreshHandler already prefers over `cwd` for
 * this exact tool, because `cwd` "is present for every tool but not guaranteed to name the
 * worktree" on this specific call. Falls back to `cwd` only if `worktreePath` is absent. Primes
 * the new cwd's caches exactly like cwdChanged, plus raises THIS call's `cwdOverrides` entry
 * (keyed by agent_id/session_id, never a bare global — see overrideKey) so every later
 * format_pre/format_post call from the SAME agent resolves against the worktree regardless of
 * what `cwd` the platform reports going forward, without disturbing a concurrently running
 * sibling agent's own override. Fail open: any error leaves the override untouched. */
export async function worktreeEntered(args: PostToolUseHookInput): Promise<HookResult> {
  try {
    const reported = args?.tool_response?.worktreePath;
    const newCwd = typeof reported === "string" && reported ? reported : typeof args?.cwd === "string" ? args.cwd : "";
    if (!newCwd) return {};
    const key = overrideKey(args);
    if (!key) return {}; // no way to scope the override to this agent -- leave args.cwd as-is
    const previous = cwdOverrides.get(key);
    if (previous && previous !== newCwd) clearPrettierIgnoreCache(previous);
    cwdOverrides.set(key, newCwd);
    primePrettierIgnoreCache(newCwd);
    await warmPrettierConfigCache(newCwd);
  } catch {
    /* fail open: a cache prefetch must never surface as a hook failure */
  }
  return {};
}
