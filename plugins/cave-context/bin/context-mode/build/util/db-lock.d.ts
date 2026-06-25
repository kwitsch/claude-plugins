/**
 * db-lock — Per-DB lockfile primitive for single-writer enforcement (#560).
 *
 * Issue #560: multiple context-mode MCP servers writing the same on-disk
 * SQLite content store unbounded the WAL — readers held shared locks
 * indefinitely so `wal_checkpoint(TRUNCATE)` never fired, and the only
 * existing truncation path is `closeDB`'s checkpoint on graceful exit
 * (which #559's zombie servers never reach). Result: 238MB+ WAL files
 * and ctx_search hangs.
 *
 * This module provides a tiny atomic-write primitive sitting in front of
 * `new Database(...)`. The first opener writes its PID into
 * `<dbPath>.lock` via O_EXCL (`flag: 'wx'`). Subsequent openers either:
 *
 *   - find the lockfile + see the PID is alive → throw
 *     DatabaseLockedError with the reporter's verbatim message;
 *   - find the lockfile + see the PID is dead → claim it, with a re-read
 *     check to resolve a same-instant race between two stale-claimers.
 *
 * The lockfile is the PRIMARY single-writer defense. The SQLiteBase ctor
 * also applies `locking_mode = EXCLUSIVE` as a SECONDARY defense
 * (belt-and-braces) — the lockfile owns the user-facing UX, EXCLUSIVE
 * catches the narrow race window between the lockfile check and the
 * actual `Database(...)` open.
 *
 * Per-process tmp DBs (those under `os.tmpdir()`) skip the lockfile
 * entirely — those are the existing `defaultDBPath()` shape and embed
 * `process.pid` already, so cross-instance contention is impossible.
 *
 * `isProcessAlive` is COPIED from `store.ts:187` — not imported — to
 * keep `db-base.ts` (which imports this module) free of any dependency
 * on `store.ts` (which itself imports from `db-base.ts`). See
 * PR-559-560-FIX-DESIGN.md regression risks #4.
 */
/** User-facing failure used by SQLiteBase to surface the contention. */
export declare class DatabaseLockedError extends Error {
    readonly pid: number;
    readonly dbPath: string;
    constructor(pid: number, dbPath: string);
}
export interface AcquireOptions {
    dbPath: string;
}
export interface AcquireResult {
    /** True when the lockfile was skipped because dbPath is under tmpdir. */
    skipped: boolean;
}
/**
 * Atomically claim the lockfile for `dbPath`. Throws `DatabaseLockedError`
 * if another live process holds it. Silently claims stale lockfiles whose
 * owning PID is dead.
 */
export declare function acquireDbLock(opts: AcquireOptions): AcquireResult;
export interface ReleaseOptions {
    dbPath: string;
}
/**
 * Drop the lockfile for `dbPath`. Swallows all errors so callers can
 * always invoke this in a finally / cleanup path without try/catch —
 * mirrors the shape of `db-base.ts closeDB`.
 *
 * Skipped (no-op) when `dbPath` is under tmpdir — symmetric with
 * `acquireDbLock`'s skip-gate.
 */
export declare function releaseDbLock(opts: ReleaseOptions): void;
