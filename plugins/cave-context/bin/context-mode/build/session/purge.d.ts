/**
 * purgeSession — deep module that wipes ALL session-related on-disk artifacts
 * for a single project directory.
 *
 * Why a deep module instead of an inline handler:
 *   - The previous inline ctx_purge handler was 100+ lines split across three
 *     try/catch blocks. Only ONE of those blocks knew about the case-fold
 *     migration's dual-hash legacy filenames, so a partial upgrade could
 *     leak orphaned events.md / .cleanup files on macOS / Windows.
 *   - Centralizing the logic here means: one canonical sidecar list, one
 *     uniform dual-hash sweep, one place to add new file kinds.
 *
 * Worktree separation guarantee (carried over from the case-fold migration):
 *   Every path this module touches is derived deterministically from the input
 *   `projectDir`. There is NO `readdirSync` + glob-filter loop. Different
 *   worktrees → different physical paths → different canonical hashes →
 *   different file names → cannot collapse worktrees on disk.
 *
 * SQLite sidecar handling:
 *   Each `.db` file may be accompanied by `-wal` (write-ahead log) and `-shm`
 *   (shared memory index) sidecars. We unlink the triple unconditionally —
 *   missing sidecars are not an error. This matches the canonical SQLite
 *   sidecar naming used elsewhere (see refs/platforms/zed/crates/sqlez:
 *   `[main, "{main}-wal", "{main}-shm"]`).
 *
 * Cross-platform notes:
 *   - All paths are joined via `node:path.join` so Windows backslash
 *     separators and POSIX forward slashes both work.
 *   - On macOS / Windows (case-insensitive FS) we sweep BOTH the canonical
 *     (lowercased) and legacy (raw-cased) project-dir hash variants for the
 *     session-related kinds. On Linux the two hashes coincide, so the dual
 *     sweep collapses into a single unique-path pass.
 */
export interface PurgeOpts {
    /**
     * Absolute path to the project root. Drives every other path the module
     * touches via the project-dir hash. MUST be the same string the rest of
     * the system uses (e.g. `getProjectDir()`); otherwise the wrong DB is
     * targeted. Worktree separation is preserved — only files matching
     * THIS projectDir's hash are unlinked.
     */
    projectDir: string;
    /**
     * Adapter-specific session directory (e.g. `~/.claude/context-mode/sessions`).
     * Holds: `<hash><suffix>.db`, `<hash><suffix>-events.md`,
     * `<hash><suffix>.cleanup`.
     */
    sessionsDir: string;
    /**
     * Absolute path to the per-project FTS5 knowledge-base DB
     * (e.g. `~/.claude/context-mode/content/<hash>.db`). When omitted no
     * FTS5 wipe runs. Caller is responsible for closing any open handle
     * BEFORE invoking purgeSession (Windows file locks).
     *
     * Use `contentDir` instead for new code — it dual-sweeps the canonical
     * AND legacy raw-casing variants, mirroring the session events pattern.
     * `storePath` remains for callers that have already pre-resolved a single
     * absolute path and only want to wipe that exact file.
     */
    storePath?: string;
    /**
     * Per-platform FTS5 content directory (e.g.
     * `~/.claude/context-mode/content`). When provided, purgeSession sweeps
     * BOTH the canonical and legacy raw-casing hash variants of the FTS5
     * store inside this directory plus their `-wal` / `-shm` sidecars. This
     * is the recommended input — covers a partial upgrade where the user
     * had been writing to a legacy raw-casing FTS5 file before the case-fold
     * migration landed.
     *
     * Mutually-additive with `storePath`: if both are passed, both are swept
     * (de-duped on path). Closing FTS5 handles before invoking is still the
     * caller's responsibility.
     */
    contentDir?: string;
    /**
     * Legacy shared content directory at `~/.context-mode/content`. When
     * omitted, the legacy content sweep is skipped.
     */
    legacyContentDir?: string;
    /**
     * Hash used to locate the legacy shared content DB. Required when
     * `legacyContentDir` is provided. Computed by the caller because the
     * legacy code-path uses a different hash function than the canonical
     * session DB hash.
     */
    contentHash?: string;
    /**
     * Issue #520 — scoped purge.
     *
     *  - `"project"` (default when omitted for back-compat callers that
     *    only pass `confirm:true` at the MCP layer): wipe ALL session
     *    artifacts for `projectDir`. This is the legacy destructive
     *    behavior preserved verbatim.
     *  - `"session"`: wipe ONLY the rows for `sessionId` inside the
     *    project's SessionDB plus FTS5 chunks tagged with that
     *    `session_id`. Project-wide files (events.md, content store
     *    file, stats file) are left intact. Requires `sessionId`.
     *
     * When `scope` is omitted but `sessionId` is set, behavior implies
     * `scope:"session"` (a sessionId-only call cannot mean "wipe the
     * whole project"). When neither is set, behavior implies
     * `scope:"project"` for back-compat with the original handler.
     */
    scope?: "session" | "project";
    /**
     * Session identifier whose rows should be wiped from the project's
     * SessionDB and tagged FTS5 chunks. Only consulted when `scope ===
     * "session"`. The `session_events`, `session_meta`, and
     * `session_resume` rows for this id are removed; rows for other
     * sessions in the same DB are preserved. Match SessionDB.deleteSession
     * semantics (see src/session/db.ts).
     */
    sessionId?: string;
}
export interface PurgeResult {
    /**
     * Human-readable labels rendered to the user by the ctx_purge handler.
     * MUST stay backward-compatible with the existing UI strings:
     *   "knowledge base (FTS5)", "session events DB", "session events markdown".
     * Each label appears at most once, and only when at least one matching
     * file was actually unlinked.
     */
    deleted: string[];
    /**
     * Every full path that was successfully `unlink`ed. Surfaced for tests
     * and for diagnostic logging — NEVER shown to end users (the labels
     * above carry the human story).
     */
    wipedPaths: string[];
}
/**
 * Wipe every session-related on-disk artifact for `projectDir`.
 *
 * This function never throws on missing files (a fresh install is a no-op).
 * It throws only when given an invalid argument (e.g. `legacyContentDir`
 * without `contentHash`), which is a programmer bug not a runtime concern.
 */
export declare function purgeSession(opts: PurgeOpts): PurgeResult;
