// handlers.ts — the two hook handlers plus their pure helpers. Fail open is the contract: every
// guard failure and every caught error returns {}. The TS port must never "tighten" that away
// because a type says a value cannot be undefined.
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { EXT_MAP, PRETTIER_LANGS, REGISTRY, selectFormatter } from "./registry.js";
import { PRETTIER_CONFIG_FILENAMES, clearPrettierConfigCaches, formatInProcess, isPrettierIgnored, primePrettierIgnoreCache } from "./prettier.js";

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

/** `filePath` as a cwd-relative path when it resolves INSIDE `cwd` (or equals it), else null.
 * `path.relative` is the containment test on purpose: the older
 * `resolved !== cwd && !resolved.startsWith(cwd + path.sep)` form rejected EVERY file when `cwd`
 * carried a trailing separator or was `/`, silently formatting nothing for that whole session.
 * `".."` alone and `".." + sep` are both checked so a legitimate `..foo.json` still passes, and
 * an absolute result (a different Windows drive) is rejected too. `resolved === cwd` yields `""`,
 * which is accepted here and dropped later by the EXT_MAP language guard exactly as before. */
function relativeInCwd(cwd: string, filePath: string): string | null {
  const resolved = path.resolve(cwd, filePath);
  const rel = path.relative(cwd, resolved);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return null;
  return rel;
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
    const cwd = typeof args?.cwd === "string" ? args.cwd : "";
    const fp = args?.tool_input?.file_path;
    if (!cwd || typeof fp !== "string" || !fp) return {};

    const resolved = path.resolve(cwd, fp);
    const rel = relativeInCwd(cwd, resolved);
    if (rel === null) return {};
    if (isExcludedPath(rel)) return {};

    // The write has landed by now, so this is the only correct moment to invalidate/refresh. Runs
    // BEFORE the language guard on purpose: most of these basenames have no extension at all
    // (`.prettierrc`, `.editorconfig`, `.prettierignore`), so EXT_MAP would drop them and neither
    // cache would ever be touched. primePrettierIgnoreCache always re-reads the CWD-ROOTED ignore
    // files, so a write to a nested `sub/.prettierignore` triggers a harmless (and correct)
    // re-read of the cwd-rooted pair rather than mistaking the written file for the cached one.
    const basename = path.basename(resolved);
    if (CACHE_INVALIDATING_BASENAMES.has(basename)) clearPrettierConfigCaches();
    if (PRETTIER_IGNORE_BASENAMES.has(basename)) primePrettierIgnoreCache(cwd);

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

    const selection = selectFormatter(entry.chain, resolved, cwd);
    if (!selection) return {};
    const { tool, argv } = selection;

    const before = readFileSync(resolved);
    try {
      await execFile(tool.name, [...argv, resolved], { cwd, timeout: SPAWN_TIMEOUT_MS });
    } catch {
      /* spawn/non-zero-exit failure is a silent no-op -- some tools (ktlint) exit non-zero after
       * a successful format, so this must never gate the before/after diff below */
    }
    const after = readFileSync(resolved);
    if (before.equals(after)) return {};

    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `universal-format: ${tool.name} reformatted ${rel}; re-read it before further string-based edits. This reformat is intentional and exempt from "surgical/minimal-diff" change-scope rules — do not revert or redo it by hand to shrink the diff.`,
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
    const cwd = typeof args?.cwd === "string" ? args.cwd : "";
    const fp = args?.tool_input?.file_path;
    if (!cwd || typeof fp !== "string" || !fp) return {};

    const resolved = path.resolve(cwd, fp);
    const rel = relativeInCwd(cwd, resolved);
    if (rel === null) return {};
    if (isExcludedPath(rel)) return {};

    const lang = EXT_MAP[path.extname(resolved).toLowerCase()];
    if (!lang || !PRETTIER_LANGS.has(lang)) return {};

    if (await isPrettierIgnored(resolved, cwd)) return {};

    const notice = `universal-format: prettier reformatted ${rel}; re-read it before further string-based edits. This reformat is intentional and exempt from "surgical/minimal-diff" change-scope rules — do not revert or redo it by hand to shrink the diff.`;

    if (args.tool_name === "Write") {
      const content = args.tool_input.content;
      if (typeof content !== "string") return {};
      const formatted = await formatInProcess(content, resolved, cwd, lang);
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
      const formatted = await formatInProcess(merged, resolved, cwd, lang);
      if (formatted === merged) return {};
      return { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { file_path: fp, old_string: current, new_string: formatted, replace_all: false }, additionalContext: notice } };
    }

    return {};
  } catch {
    return {};
  }
}
