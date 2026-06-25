/**
 * db-base — Reusable SQLite infrastructure for context-mode packages.
 *
 * Provides lazy-loading of better-sqlite3, WAL pragma setup, prepared
 * statement caching interface, and DB file cleanup helpers. Both
 * ContentStore and SessionDB build on top of these primitives.
 */
import type DatabaseConstructor from "better-sqlite3";
import type { Database as DatabaseInstance } from "better-sqlite3";
/**
 * Explicit interface for cached prepared statements that accept varying
 * parameter counts. better-sqlite3's generic `Statement` collapses under
 * `ReturnType` to a single-param signature, so we define our own.
 */
export interface PreparedStatement {
    run(...params: unknown[]): {
        changes: number;
        lastInsertRowid: number | bigint;
    };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    iterate(...params: unknown[]): IterableIterator<unknown>;
}
/**
 * Wraps a bun:sqlite Database to provide better-sqlite3-compatible API.
 * Bridges: .pragma(), multi-statement .exec(), .get() null→undefined.
 */
export declare class BunSQLiteAdapter {
    #private;
    constructor(rawDb: any);
    pragma(source: string): any;
    exec(sql: string): any;
    prepare(sql: string): any;
    transaction(fn: (...args: any[]) => any): any;
    close(): void;
}
/**
 * Wraps node:sqlite's DatabaseSync to provide better-sqlite3-compatible API.
 * Bridges: .pragma(), .transaction(). Everything else is passthrough.
 * Eliminates native addon SIGSEGV on Linux (nodejs/node#62515).
 */
export declare class NodeSQLiteAdapter {
    #private;
    constructor(rawDb: any);
    pragma(source: string): any;
    exec(sql: string): any;
    prepare(sql: string): any;
    transaction(fn: (...args: any[]) => any): any;
    close(): void;
}
/**
 * Probe whether the supplied node:sqlite DatabaseSync constructor links a
 * SQLite build that includes the FTS5 module. Some Node.js Linux builds
 * (e.g. v22.14.0 on Ubuntu) ship node:sqlite without FTS5 even though the
 * import succeeds, which silently breaks ctx_search/ctx_batch_execute and
 * the doctor's FTS5 check (issue #461).
 *
 * Returns true only when a `CREATE VIRTUAL TABLE … USING fts5(x)` statement
 * succeeds. Always returns false on any failure (constructor throw, missing
 * module, etc.) so the caller can fall through to better-sqlite3, whose
 * bundled SQLite always ships with FTS5.
 */
export declare function nodeSqliteHasFts5(DatabaseSync: any): boolean;
/**
 * Returns true when the current runtime ships a built-in SQLite binding:
 * - Bun has `bun:sqlite` always
 * - Node has `node:sqlite` since 22.5 (no flag since 22.13)
 *
 * Mirrors the helper in hooks/ensure-deps.mjs:61. Exported so the platform
 * gate in loadDatabase() can be unit-tested without spawning a child
 * process. `versionsOverride` and `bunOverride` are injection points for
 * tests — production callers pass nothing.
 *
 * Widening the gate from `process.platform === "linux"` to this helper is
 * required for Node 26 on macOS arm64 (#551): Node 26 removed
 * `info.This()` from V8 PropertyCallbackInfo, breaking better-sqlite3
 * 12.9.0's native compile. Using node:sqlite sidesteps the native addon
 * entirely on every platform that has it.
 */
export declare function hasModernSqlite(versionsOverride?: NodeJS.ProcessVersions, bunOverride?: unknown): boolean;
/**
 * Lazy-load the SQLite driver for the current runtime.
 * Bun → bun:sqlite via BunSQLiteAdapter (issue #45).
 * Modern Node (>= 22.5) → node:sqlite via NodeSQLiteAdapter when it ships FTS5 (#228, #461, #551).
 * Other Node (or modern Node without FTS5) → better-sqlite3 (native addon).
 */
export declare function loadDatabase(): typeof DatabaseConstructor;
/**
 * Apply WAL mode and NORMAL synchronous pragma to a database instance.
 * Should be called immediately after opening a new database connection.
 *
 * WAL mode provides:
 * - Concurrent readers while a write is in progress
 * - Dramatically faster writes (no full-page sync on each commit)
 * NORMAL synchronous is safe under WAL and avoids an extra fsync per
 * transaction.
 */
export declare function applyWALPragmas(db: DatabaseInstance): void;
/**
 * Remove orphaned WAL/SHM files when the main DB file doesn't exist.
 * On Windows, stale -wal/-shm files from crashed processes cause
 * "file is not a database" errors when creating a fresh DB.
 */
export declare function cleanOrphanedWALFiles(dbPath: string): void;
/**
 * Delete all three SQLite files for a given db path (main, WAL, SHM).
 * Silently ignores individual deletion errors so a partial cleanup
 * does not abort the rest.
 */
export declare function deleteDBFiles(dbPath: string): void;
/**
 * Safely close a database connection. Swallows errors so callers can
 * always call this in a finally/cleanup path without try/catch.
 */
export declare function closeDB(db: DatabaseInstance): void;
/**
 * Return the default per-process DB path for context-mode databases.
 * Uses the OS temp directory and embeds the current PID so multiple
 * server instances never share a file.
 */
export declare function defaultDBPath(prefix?: string): string;
/**
 * Retry a DB operation with exponential backoff on SQLITE_BUSY errors.
 * Catches errors containing "SQLITE_BUSY" or "database is locked" and
 * retries up to 3 times with delays: 100ms, 500ms, 2000ms.
 * If all retries fail, throws a descriptive error.
 * Pass custom delays for testing (e.g., [0, 0, 0] to skip waits).
 */
export declare function withRetry<T>(fn: () => T, delays?: number[]): T;
/**
 * Detect SQLite corruption errors that warrant a rename-and-recreate.
 * Matches SQLITE_CORRUPT, SQLITE_NOTADB, and their human-readable equivalents.
 */
export declare function isSQLiteCorruptionError(msg: string): boolean;
/**
 * Rename a corrupt DB and its WAL/SHM files so a fresh DB can be created.
 * Best-effort — individual rename failures are silently ignored.
 */
export declare function renameCorruptDB(dbPath: string): void;
export declare abstract class SQLiteBase {
    #private;
    /**
     * Open (or create) a SQLite DB at `dbPath`.
     *
     * v1.0.130 — multi-writer is the contract. ALL SQLiteBase consumers
     * (SessionDB, ContentStore) may open the same on-disk dbPath from
     * multiple processes simultaneously — that is the legitimate multi-
     * window UX shape and the WAL handles it natively. SQLITE_BUSY on
     * write contention is absorbed by `withRetry()` below (busy_timeout
     * = 30000ms inside `new Database(...)`).
     *
     * v1.0.128 introduced a single-writer guard here as a defense against
     * #560. That defense was an over-correction — the actual root causes
     * of #560 were #559 (zombie MCP child accumulation) and #561 (Pi
     * misdetection writing to the wrong DB path), both fixed in v1.0.128
     * + v1.0.129. The single-writer guard broke legitimate multi-window
     * users; v1.0.130 rolls it out. See
     * docs/adr/0001-sessiondb-multi-writer.md and the v1.0.130 INVARIANT
     * block in tests/util/db-base-platform-gate.test.ts for the
     * regression-proof anchor (source-pin + behavioural).
     */
    constructor(dbPath: string);
    /** Called once after WAL pragmas are applied. Subclasses run CREATE TABLE/VIRTUAL TABLE here. */
    protected abstract initSchema(): void;
    /** Called once after schema init. Subclasses compile and cache their prepared statements here. */
    protected abstract prepareStatements(): void;
    /** Raw database instance — available to subclasses only. */
    protected get db(): DatabaseInstance;
    /** The path this database was opened from. */
    get dbPath(): string;
    /** Close the database connection without deleting files. */
    close(): void;
    protected withRetry<T>(fn: () => T): T;
    /**
     * Close the connection and delete all associated DB files (main, WAL, SHM).
     * Call on process exit or at end of session lifecycle.
     */
    cleanup(): void;
}
