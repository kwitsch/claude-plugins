/**
 * walkDirectory — bounded recursive directory walker for ctx_index (#687).
 *
 * Issue: ctx_index refused directory paths via the security gate at
 * src/store.ts:845 ("refusing to index <path>: not a regular file"). The gate
 * is a TOCTOU defense from #442 round-3 and MUST be preserved — directory
 * support is layered as a separate concern here. Each file produced by
 * walkDirectory is then read via the existing per-file
 * `openSync + fstatSync.isFile()` invariant in `ContentStore.index()`.
 *
 * Reported by @matiasduartee across 4 clients × Windows 11.
 * https://github.com/anthropic-experimental/context-mode/issues/687
 *
 * Design constraints:
 *   - No new dependencies (avoid the `ignore` package — issue #687 Diagnose).
 *   - Cross-OS: path.sep / path.join everywhere, never raw "/" string ops.
 *   - Symlink cycle detection via a resolved-path Set.
 *   - Symlink-escape rejection: refuse to follow symlinks that resolve outside
 *     the rootPath (defense-in-depth alongside per-file checkFilePathDenyPolicy).
 *   - FTS5-blowup guard: hard cap maxFiles (default 200, per Architect).
 */
export interface WalkOptions {
    /** Glob-ish include patterns. Empty/undefined means include all (subject to extensions). */
    include?: string[];
    /** Glob-ish exclude patterns. Merged with sensible defaults. */
    exclude?: string[];
    /** Max recursion depth from rootPath (0 = root only). Default 5. */
    maxDepth?: number;
    /** Hard cap on total files. Default 200 — FTS5 blow-up guard. */
    maxFiles?: number;
    /** Allowed file extensions (with leading dot). Empty/undefined means default set. */
    extensions?: string[];
    /** Apply nearest .gitignore rules during walk. Default true. */
    respectGitignore?: boolean;
    /** Follow directory symlinks. Default false (cycle hazard + escape risk). */
    followSymlinks?: boolean;
}
export interface WalkResult {
    files: string[];
    /** True when maxFiles cap was hit and traversal halted early. */
    capped: boolean;
    /** Total files discovered before cap (for reporting). */
    totalSeen: number;
}
/**
 * Walk `rootPath` recursively under the given bounds and return absolute file
 * paths matching the filters. Pure synchronous traversal — no allocations
 * beyond the result array. Symlink cycles are detected via a resolved-path
 * Set; symlink escapes (resolving outside rootPath) are silently skipped.
 */
export declare function walkDirectory(rootPath: string, opts?: WalkOptions): string[];
/**
 * Same as walkDirectory but returns capped + totalSeen so callers can surface
 * a "capped at N files" notice in their response.
 */
export declare function walkDirectoryDetailed(rootPath: string, opts?: WalkOptions): WalkResult;
