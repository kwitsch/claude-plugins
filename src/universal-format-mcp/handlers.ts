// handlers.ts — the format_pre hook handler plus its pure helpers. Fail open is the contract: every
// guard failure and every caught error returns {}. The TS port must never "tighten" that away
// because a type says a value cannot be undefined.
import path from "node:path";
import os from "node:os";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { EXT_MAP, PRETTIER_LANGS, REGISTRY, selectFormatter } from "./registry.js";
import type { FormatTool } from "./types.js";
import { walkToRoot } from "./util.js";
import { PRETTIER_CONFIG_FILENAMES, clearPrettierConfigCaches, formatInProcess, isPrettierIgnored, primePrettierIgnoreCache } from "./prettier.js";

const SPAWN_TIMEOUT_MS = 30000; // inner formatter timeout; the hook-level timeout:60 is the backstop

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

/** True when `resolved` is `dir` itself or lives underneath it; returns the relative path, or
 * `null` when it is not contained. `path.relative` is the containment test on purpose: the older
 * `resolved !== dir && !resolved.startsWith(dir + path.sep)` form answered "no" for EVERY file
 * when `dir` carried a trailing separator or was `/`. Do not "simplify" it back. */
function relativeIfContains(dir: string, resolved: string): string | null {
  const rel = path.relative(dir, resolved);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return null;
  return rel;
}

// Process-lifetime memo of the out-of-cwd git-root walk, keyed by the file's own directory --
// same unreclaimed-for-the-process-lifetime growth class already accepted for ignoreCache/
// projectConfigCache in prettier.ts (bounded by the number of distinct out-of-cwd directories a
// session ever writes into). A `git init` after the first miss is not observed, consistent with
// the rest of this plugin's in-memory caches.
const gitRootCache = new Map<string, string>();

/** The nearest ancestor of `fileDir` (inclusive) holding a `.git` entry -- file or directory, so a
 * worktree's and a submodule's `.git` (a FILE) both resolve -- or `""` if none is found before
 * `home`. The walk stops AT `home` without checking it: a user's home directory is frequently a
 * git-tracked dotfiles checkout, and treating the whole home directory as "the project" for an
 * unrelated scratch file would apply that dotfiles repo's `.prettierignore`/config to it. Memoized
 * per `fileDir` for the process lifetime. */
function findGitRoot(fileDir: string, home: string): string {
  const cached = gitRootCache.get(fileDir);
  if (cached !== undefined) return cached;
  let found = "";
  walkToRoot(fileDir, (dir) => {
    if (home && dir === home) return true; // stop before treating $HOME itself as a project root
    if (!existsSync(path.join(dir, ".git"))) return false;
    found = dir;
    return true;
  });
  gitRootCache.set(fileDir, found);
  return found;
}

/** Position-independent counterpart to `isExcludedPath`'s `.claude/worktrees`/`.claude/agent-memory`
 * check, for the out-of-cwd case ONLY (callers must gate this on `base !== cwd`): the git-root walk
 * can anchor `base` AT a worktree's own root (a worktree's `.git` is a FILE, so branch 2 stops right
 * there), which erases the `.claude/worktrees` segment from a base-relative `rel` entirely and would
 * otherwise let this agent reformat a SIBLING agent's in-flight worktree/scratch state. Must never
 * be consulted when `base === cwd` -- that is the session's OWN project root, including its own
 * worktree once EnterWorktree moved it there (Claude Code reports the worktree as `cwd` from then
 * on, verified live on 2.1.303), whose absolute path legitimately contains `.claude/worktrees/<name>`
 * too; gating on `base !== cwd` keeps that case formatting. */
function isClaudeInternalPath(resolved: string): boolean {
  const segments = resolved.split(path.sep);
  return segments.some((s, i) => s === ".claude" && (segments[i + 1] === "worktrees" || segments[i + 1] === "agent-memory"));
}

/** Resolves both `base` (see `resolveBase`) and the base-relative path in one pass, so the in-cwd
 * containment check is never computed twice -- once here, and a second time by a caller
 * re-deriving `rel` from the returned `base`. */
function resolveBaseAndRel(cwd: string, resolved: string): { base: string; rel: string } {
  if (cwd) {
    const rel = relativeIfContains(cwd, resolved);
    if (rel !== null) return { base: cwd, rel };
  }
  const fileDir = path.dirname(resolved);
  const base = findGitRoot(fileDir, os.homedir()) || fileDir;
  return { base, rel: path.relative(base, resolved) };
}

/** The directory every project-scoped lookup for `resolved` anchors at: its `.prettierignore`, its
 * prettier `plugins:` resolution, the upper bound of the .editorconfig / tool-native-config walks,
 * and the formatter subprocess's own cwd. The session's `cwd` when it really contains the file
 * (unchanged behavior for the normal case, and the ONLY case whose ignore/config resolution this
 * plugin has ever promised); otherwise the file's own git root, bounded at `$HOME` -- see
 * `findGitRoot`; otherwise the file's own directory. `cwd` is a hint here, never a gate: a file
 * outside `cwd` is formatted against its own project instead of being skipped. Always returns an
 * ancestor-or-equal directory of `resolved`, so the caller's `path.relative(base, resolved)` never
 * escapes with `..` and both bounded upward walks terminate at `base` as intended. */
export function resolveBase(cwd: string, resolved: string): string {
  return resolveBaseAndRel(cwd, resolved).base;
}

/** Resolves the write target: the file path, the `base` directory every project-scoped lookup
 * anchors at, and the base-relative path used for exclusion. `cwd` is the hook payload's own --
 * Claude Code keeps it current across `cd` and EnterWorktree (verified live on 2.1.303), so there
 * is no override to consult. Returns null on any guard failure -- the caller returns {} (fail open). */
function resolveTarget(args: ToolHookInput): { cwd: string; base: string; resolved: string; rel: string; fp: string } | null {
  const cwd = typeof args?.cwd === "string" ? args.cwd : "";
  const fp = args?.tool_input?.file_path;
  if (typeof fp !== "string" || !fp) return null;
  if (!cwd && !path.isAbsolute(fp)) return null; // nothing to resolve a relative path against

  const resolved = path.resolve(cwd, fp);
  const { base, rel } = resolveBaseAndRel(cwd, resolved);
  if (isExcludedPath(rel)) return null;
  if (base !== cwd && isClaudeInternalPath(resolved)) return null; // out-of-cwd only; see isClaudeInternalPath
  return { cwd, base, resolved, rel, fp };
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

/** Start index of the line that contains index `i` of `s` (0 for the first line). */
function lineStart(s: string, i: number): number {
  return i <= 0 ? 0 : s.lastIndexOf("\n", i - 1) + 1;
}

/** Index just past the newline that ends the line containing index `i` of `s` (`s.length` for an
 * unterminated last line). */
function lineEnd(s: string, i: number): number {
  const nl = s.indexOf("\n", i);
  return nl === -1 ? s.length : nl + 1;
}

const MAX_WIDENINGS = 32; // real edits widen 1-10 times (measured p99 = 5); only repetitive fixtures hit this

/** Shrink a whole-file Edit swap to the smallest run of whole lines that differs between the
 * pre-edit file and its formatted replacement. The formatter still sees the WHOLE merged file (a
 * fragment cannot be formatted in isolation); this only trims what the Edit tool is asked to swap,
 * so a one-line edit to an already-formatted file costs a few lines of updatedInput instead of two
 * copies of the file (numbers: plugins/universal-format/CLAUDE.md). The run is widened one whole
 * line at a time -- upward first -- until `applyEdit`, the in-process mirror of the Edit tool's
 * contract, reproduces `formatted` from it (an empty or non-unique `old_string` never does), bounded
 * by MAX_WIDENINGS so repetitive text (thousands of identical lines) cannot make the scan quadratic:
 * past the bound the whole file is swapped, exactly the pre-0.18 payload. Null when nothing differs. */
export function shrinkSwap(current: string, formatted: string): { old_string: string; new_string: string } | null {
  if (current === formatted) return null;
  const max = Math.min(current.length, formatted.length);
  let prefix = 0;
  while (prefix < max && current.charCodeAt(prefix) === formatted.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && current.charCodeAt(current.length - 1 - suffix) === formatted.charCodeAt(formatted.length - 1 - suffix)) suffix++;
  // The changed run of `current` is [prefix, current.length - suffix); widen it to whole lines (a
  // pure insertion has an empty run and takes the line holding the insertion point). The swap stays
  // correct as long as `start <= prefix` and `end >= current.length - suffix`, which widening only
  // strengthens -- everything outside the run is common text.
  let start = lineStart(current, prefix);
  let end = lineEnd(current, Math.max(prefix, current.length - suffix - 1));
  const swapAt = () => ({ old_string: current.slice(start, end), new_string: formatted.slice(start, formatted.length - (current.length - end)) });
  for (let i = 0; i < MAX_WIDENINGS && (start > 0 || end < current.length); i++) {
    const swap = swapAt();
    if (applyEdit(current, swap.old_string, swap.new_string, false) === formatted) return swap;
    if (start > 0) start = lineStart(current, start - 1);
    else end = lineEnd(current, end);
  }
  return { old_string: current, new_string: formatted };
}

// The ONE base-rooted ignore file. A write to it refreshes THIS server's base-keyed ignore cache
// (prettier's own getFileInfo still caches nothing). Kept as its own set so the landed-write refresh
// can re-prime it separately from the config clear. `.gitignore` is deliberately NOT a member -- see
// isPrettierIgnored in prettier.ts.
export const PRETTIER_IGNORE_BASENAMES: Set<string> = new Set([".prettierignore"]);

// Basenames whose write invalidates prettier's cached configuration. The prettier config files
// themselves, the two files prettier reads a top-level "prettier" key out of, and .editorconfig
// (a SEPARATE cache inside prettier from .prettierrc -- verified that clearConfigCache() covers
// both). The ignore file is spread in so this set stays the single "a config-ish file was
// written" concept; clearing prettier's config cache for it really is inert, but the refresh also
// re-reads this server's own ignore state for it.
export const CACHE_INVALIDATING_BASENAMES: Set<string> = new Set([...PRETTIER_CONFIG_FILENAMES, "package.json", "package.yaml", ".editorconfig", ...PRETTIER_IGNORE_BASENAMES]);

/** Identity of a file's current on-disk state (inode, size, mtime), or "" when it does not exist. */
function fileStamp(file: string): string {
  try {
    const s = statSync(file);
    return `${s.ino}:${s.size}:${s.mtimeMs}`;
  } catch {
    return "";
  }
}

// Config-ish files a Write/Edit is about to land on. At PreToolUse the write has not happened yet,
// and clearing prettier's config cache right away would just re-cache the pre-write content on the
// next resolveConfig -- so each entry remembers the file's on-disk stamp, and the first later format
// that finds it changed (the write landed, from this agent or any concurrent one) clears the config
// caches, re-primes the base-rooted ignore state for an ignore file, and drops the entry. A write
// that never lands (a failed tool call) keeps its entry at the cost of one stat per format.
const pendingRefreshes = new Map<string, { base: string; stamp: string }>();

function noteConfigWrite(resolved: string, base: string): void {
  pendingRefreshes.set(resolved, { base, stamp: fileStamp(resolved) });
}

function refreshLandedConfigWrites(): void {
  for (const [file, pending] of pendingRefreshes) {
    if (fileStamp(file) === pending.stamp) continue; // not on disk yet
    pendingRefreshes.delete(file);
    clearPrettierConfigCaches();
    if (PRETTIER_IGNORE_BASENAMES.has(path.basename(file))) primePrettierIgnoreCache(pending.base);
  }
}

/** Run `tool` on `src` via stdin and resolve its stdout, or null unless the exit code is one of the
 * tool's `okExit` codes AND stdout is non-empty -- neither signal alone is trustworthy: black echoes
 * the UNFORMATTED input on a parse error (exit 123), ktlint reports a syntax error with exit 0 and
 * empty stdout. A spawn error (not on PATH after all), a timeout kill or a crash resolves null too;
 * nothing here throws. Promise-based, never spawnSync: this runs inside a persistent MCP server that
 * also services other concurrent hook calls, so a blocking spawn would stall every in-flight format. */
function runStdinFormatter(tool: FormatTool, argv: string[], cwd: string, src: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(tool.name, argv, { cwd, stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, SPAWN_TIMEOUT_MS);
    child.on("error", () => finish(null));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (out += chunk));
    child.on("close", (code: number | null) => finish((tool.okExit ?? [0]).includes(code ?? -1) && out.length > 0 ? out : null));
    child.stdin.on("error", () => {}); // EPIPE: the tool bailed out (syntax error) before reading everything
    child.stdin.end(src);
  });
}

/** Format `src` as the file `resolved` (language `lang`): the bundled prettier in-process for its
 * thirteen languages, else the language's first CLI formatter on PATH, fed on stdin. Resolves the
 * formatted text plus the formatter's name for the notice, or null when no formatter could run.
 * A prettier error propagates -- the handler's catch fails open. */
async function formatContent(src: string, resolved: string, base: string, lang: string): Promise<{ formatted: string; tool: string } | null> {
  if (PRETTIER_LANGS.has(lang)) return { formatted: await formatInProcess(src, resolved, base, lang), tool: "prettier" };
  const entry = REGISTRY[lang];
  if (!entry) return null;
  const selection = selectFormatter(entry.chain, resolved, base);
  if (!selection) return null;
  const cwd = selection.tool.spawnCwd === "fileDir" ? path.dirname(resolved) : base;
  const formatted = await runStdinFormatter(selection.tool, selection.argv, cwd, src);
  return formatted === null ? null : { formatted, tool: selection.tool.name };
}

/** PreToolUse handler: every supported language is formatted BEFORE the write and handed back via
 * updatedInput -- prettier languages in-process, the CLI languages through their tool on stdin.
 * Never sets permissionDecision. Returns {} on every guard failure / error (fail open). */
export async function formatPre(args: ToolHookInput): Promise<HookResult> {
  try {
    refreshLandedConfigWrites();
    const target = resolveTarget(args);
    if (!target) return {};
    const { cwd, base, resolved, rel, fp } = target;

    // A config-ish file is about to be written: refresh the caches once it has landed. Runs BEFORE
    // the language guard on purpose: most of these basenames have no extension at all
    // (`.prettierrc`, `.editorconfig`, `.prettierignore`), so EXT_MAP would drop them.
    if (CACHE_INVALIDATING_BASENAMES.has(path.basename(resolved))) noteConfigWrite(resolved, base);

    const lang = EXT_MAP[path.extname(resolved).toLowerCase()];
    if (!lang) return {};
    // `.prettierignore` opts a path out of the thirteen prettier languages; for the CLI languages the
    // opt-out is not installing the tool (README), exactly as before they moved in front of the write.
    if (PRETTIER_LANGS.has(lang) && (await isPrettierIgnored(resolved, base))) return {};

    // A repo-relative path alone is ambiguous once files from several projects can be formatted in
    // one session, so only an in-cwd file (base === cwd) keeps the short form; everything else is
    // named absolutely.
    const display = base === cwd ? rel : resolved;
    const noticeFor = (tool: string) =>
      `universal-format: ${tool} reformatted ${display}; re-read it before further string-based edits. This reformat is intentional and exempt from "surgical/minimal-diff" change-scope rules — do not revert or redo it by hand to shrink the diff.`;

    if (args.tool_name === "Write") {
      const content = args.tool_input.content;
      if (typeof content !== "string") return {};
      const result = await formatContent(content, resolved, base, lang);
      if (result === null || result.formatted === content) return {};
      return { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { file_path: fp, content: result.formatted }, additionalContext: noticeFor(result.tool) } };
    }

    if (args.tool_name === "Edit") {
      if (!existsSync(resolved)) return {};
      // The Edit tool matches old_string against LF-normalized content and writes CRLF back to a CRLF
      // file itself, so for such a file everything below runs in LF space: a `\r\n` in the swap's
      // old_string could never match, and the Edit would fail instead of failing open.
      const raw = readFileSync(resolved, "utf8");
      const crlf = raw.includes("\r\n");
      const toLf = (s: string) => (crlf ? s.replaceAll("\r\n", "\n") : s);
      const current = toLf(raw);
      const oldStr = args.tool_input.old_string;
      const newStr = args.tool_input.new_string;
      if (typeof oldStr !== "string" || typeof newStr !== "string") return {};
      // `=== "true"` too: hooks.json's mcp_tool `input` reconstructs this field via `${...}` string
      // substitution (Claude Code has no documented type-preserving whole-value substitution), so a
      // real boolean may arrive stringified rather than as a boolean.
      const replaceAll = args.tool_input.replace_all;
      const merged = applyEdit(current, oldStr, newStr, replaceAll === true || replaceAll === "true");
      if (merged === null) return {}; // absent OR non-unique -> let the original Edit proceed/err
      const result = await formatContent(merged, resolved, base, lang);
      if (result === null) return {};
      const formatted = toLf(result.formatted);
      if (formatted === merged) return {};
      // null: the formatter turns the edit straight back into the pre-edit file, so the formatted
      // result IS what is on disk. Letting the raw edit land would leave the file unformatted until
      // its next write, so hand the Edit tool a no-op instead (old_string == new_string: rejected or
      // applied as nothing, the file stays formatted either way) and tell Claude why.
      const swap = shrinkSwap(current, formatted);
      if (swap === null) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            updatedInput: { file_path: fp, old_string: oldStr, new_string: oldStr, replace_all: replaceAll === true || replaceAll === "true" },
            additionalContext: `universal-format: ${result.tool} formats this edit straight back to the current content of ${display}, so there is nothing to change; the Edit was turned into a no-op and the file is unchanged.`,
          },
        };
      }
      return { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { file_path: fp, ...swap, replace_all: false }, additionalContext: noticeFor(result.tool) } };
    }

    return {};
  } catch {
    return {};
  }
}
