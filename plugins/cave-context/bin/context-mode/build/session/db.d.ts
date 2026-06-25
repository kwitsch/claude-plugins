/**
 * SessionDB — Persistent per-project SQLite database for session events.
 *
 * Stores raw events captured by hooks during a Claude Code session,
 * session metadata, and resume snapshots. Extends SQLiteBase from
 * the shared package.
 */
import { SQLiteBase } from "../db-base.js";
import type { SessionEvent } from "../types.js";
import type { ProjectAttribution } from "./project-attribution.js";
declare const STORAGE_ROOT_ENV: "CONTEXT_MODE_DIR";
export type StorageDirectoryKind = "session" | "content" | "stats";
export type StorageOverrideEnvVar = typeof STORAGE_ROOT_ENV;
export type StorageDirectorySource = "default" | "override";
export type IgnoredStorageOverrideReason = "empty";
export interface ResolvedStorageDir {
    kind: StorageDirectoryKind;
    path: string;
    envVar: StorageOverrideEnvVar | null;
    source: StorageDirectorySource;
    ignoredEnvVar?: StorageOverrideEnvVar;
    ignoredReason?: IgnoredStorageOverrideReason;
}
export declare class StorageDirectoryError extends Error {
    readonly kind: StorageDirectoryKind;
    readonly path: string;
    readonly overrideEnvVar: StorageOverrideEnvVar;
    readonly ignoredEnvVar?: StorageOverrideEnvVar;
    readonly ignoredReason?: IgnoredStorageOverrideReason;
    constructor(kind: StorageDirectoryKind, path: string, overrideEnvVar?: StorageOverrideEnvVar, cause?: unknown, message?: string, metadata?: Pick<ResolvedStorageDir, "ignoredEnvVar" | "ignoredReason">);
}
export interface DefaultSessionDirOptions {
    configDir: string;
    configDirEnv?: string;
    legacySessionDirEnv?: string;
    onLegacySessionDir?: (envVar: string, dir: string) => void;
    env?: NodeJS.ProcessEnv;
}
export declare function resolveDefaultSessionDir(opts: DefaultSessionDirOptions): string;
export declare function resolveSessionStorageDir(getDefaultDir: () => string): ResolvedStorageDir;
export declare function resolveContentStorageDir(getSessionDir: () => string): ResolvedStorageDir;
export declare function resolveStatsStorageDir(getDefaultSessionDir: () => string): ResolvedStorageDir;
export declare function formatStorageDirectoryError(err: StorageDirectoryError): string;
export declare function describeStorageDirectorySource(dir: ResolvedStorageDir): string;
export declare function clearStorageDirectoryCheckCacheForTests(): void;
export declare function ensureWritableStorageDir(dir: ResolvedStorageDir): string;
export declare function normalizeWorktreePath(path: string): string;
export declare function getWorktreeSuffix(projectDir?: string): string;
export declare function _resetWorktreeSuffixCacheForTests(): void;
/**
 * Hash a project directory the way the deployed code (≤ v1.0.111) did:
 * normalize slashes only, preserve raw casing. Kept exported so the
 * migration helper can locate pre-fix DB files for one-shot rename.
 *
 * Do NOT call this for new code paths — use {@link hashProjectDirCanonical}.
 */
export declare function hashProjectDirLegacy(projectDir: string): string;
/**
 * Hash a project directory case-stably. On case-insensitive filesystems
 * (macOS HFS+/APFS, Windows NTFS) the path is lowercased so that
 * `/Users/Mert/proj` and `/users/mert/proj` resolve to the same DB file.
 * On Linux (case-sensitive) casing is preserved.
 *
 * Used as the base half of the SessionDB filename:
 *   <baseHash><worktreeSuffix>.db
 */
export declare function hashProjectDirCanonical(projectDir: string): string;
/**
 * Resolve the per-project FTS5 content store DB path, performing a one-shot
 * migration from a legacy raw-casing filename to the canonical one when only
 * the legacy file (with optional `-wal` / `-shm` SQLite sidecars) exists.
 *
 * Same dual-hash safety contract as {@link resolveSessionDbPath}:
 *   - Linux: canonical hash equals legacy hash → no migration attempted.
 *   - Mac/Win: rename legacy → canonical when canonical missing.
 *   - Both exist: leave legacy alone (data-loss safety). Caller picks
 *     canonical; reconciliation is a manual operation.
 *
 * Differs from `resolveSessionDbPath` in two ways:
 *   1. No worktree suffix — the FTS5 store is per-project, not per-worktree.
 *   2. The `-wal` / `-shm` sidecars travel with the main `.db` during
 *      migration so an active SQLite WAL checkpoint is not stranded behind.
 */
export declare function resolveContentStorePath(opts: {
    projectDir: string;
    contentDir: string;
}): string;
/**
 * Resolve the SessionDB file path for a project, performing a one-shot
 * migration from legacy raw-casing filenames to canonical ones when only
 * the legacy file exists.
 *
 * Migration rules:
 *   - Linux: `legacyHash === canonicalHash` so the resolver short-circuits;
 *     no migration ever runs (case-sensitive FS, never any drift).
 *   - macOS / Windows: if the canonical path does not exist but a legacy
 *     path does, rename in place. This preserves the user's session
 *     history across the casing-fix upgrade.
 *   - When BOTH paths exist (rare — usually only if the user previously
 *     ran two terminals with different casing) the legacy file is left
 *     UNTOUCHED. The canonical path wins; manual reconciliation needed.
 *     Avoiding the rename here is the data-loss safety guarantee.
 *
 * Worktree separation is preserved: each call only ever migrates the ONE
 * legacy file matching THIS projectDir's hash. Different worktrees have
 * different physical paths → different hashes → different DB files; the
 * migration cannot collapse worktrees.
 */
export declare function resolveSessionDbPath(opts: {
    projectDir: string;
    sessionsDir: string;
}): string;
/**
 * Generalized resolver: same case-fold + one-shot legacy-rename semantics
 * as {@link resolveSessionDbPath}, parameterised on the file extension so
 * the SAME logic powers `.db`, `-events.md`, and `.cleanup` paths.
 *
 * Source of truth for hooks: `hooks/session-helpers.mjs` imports this
 * function from the bundled output (`hooks/session-db.bundle.mjs`) so the
 * JS hooks and the TS server can never drift again on hash, suffix, or
 * migration policy.
 *
 * Optional `suffix` lets the hook layer inject its cross-process cached
 * worktree suffix (the marker-file optimisation that amortises the
 * `git worktree list` cost across hook forks). When omitted, falls back
 * to {@link getWorktreeSuffix} which uses an in-process cache only.
 */
export declare function resolveSessionPath(opts: {
    projectDir: string;
    sessionsDir: string;
    ext: string;
    suffix?: string;
}): string;
/** A stored event row from the session_events table. */
export interface StoredEvent {
    id: number;
    session_id: string;
    type: string;
    category: string;
    priority: number;
    data: string;
    project_dir: string;
    attribution_source: string;
    attribution_confidence: number;
    bytes_avoided: number;
    bytes_returned: number;
    source_hook: string;
    created_at: string;
    data_hash: string;
}
/** Optional per-event byte accounting passed to {@link SessionDB.insertEvent}. */
export interface EventBytes {
    /** Bytes context-mode prevented from entering the model context window. */
    bytesAvoided?: number;
    /** Bytes context-mode actually returned to the model. */
    bytesReturned?: number;
}
/** Session metadata row from the session_meta table. */
export interface SessionMeta {
    session_id: string;
    project_dir: string;
    started_at: string;
    last_event_at: string | null;
    event_count: number;
    compact_count: number;
}
/**
 * Session rollup snapshot (seed-parity aggregate).
 *
 * 12 fields that mirror the platform's `session_summary` + `session_metadata`
 * stamps from src/routes/seed.ts. Each outgoing canonical event carries
 * this snapshot computed at the moment of forward so the analytics engine
 * can run its SUM/AVG/MAX rollups across per-event rows.
 */
export interface SessionRollup {
    tool_calls: number;
    errors: number;
    unique_tools: number;
    unique_files: number;
    max_file_edits: number;
    has_commit: 0 | 1;
    commit_message: string;
    edit_test_cycles: number;
    duration_min: number;
    compact_count: number;
    sources_indexed: number;
    total_chunks: number;
    search_queries: number;
}
/** Resume snapshot row from the session_resume table. */
export interface ResumeRow {
    snapshot: string;
    event_count: number;
    consumed: number;
}
/** Aggregated tool-call stats for a single session. */
export interface ToolCallStats {
    totalCalls: number;
    totalBytesReturned: number;
    byTool: Record<string, {
        calls: number;
        bytesReturned: number;
    }>;
}
/**
 * Apply any missing post-v1.0.130 `session_events` columns to an already-
 * open writable database handle. Idempotent — each ALTER is guarded by a
 * PRAGMA table_xinfo check, and the project_dir index is created only
 * when a migration actually ran. Returns true if any column was added.
 *
 * Used by both the SessionDB constructor (for the active DB) and the
 * analytics aggregator (for the 100+ historical DBs that never get
 * opened through SessionDB). ADR-0001 compatible: no EXCLUSIVE pragma,
 * no acquireDbLock — relies on the SQLite busy_timeout + WAL semantics
 * already provided by SQLiteBase.
 */
export declare function applyMissingSessionEventsColumns(db: {
    pragma: (q: string) => Array<{
        name: string;
    }>;
    exec: (sql: string) => void;
}): boolean;
/**
 * Open a session DB file briefly, run any missing schema migrations,
 * and close. Best-effort: missing tables, file-locks, corrupt files,
 * and any DatabaseCtor error are swallowed silently — the caller
 * (analytics aggregator) handles the readonly query that follows and
 * will skip the DB if it remains unreadable.
 *
 * Lazy migration entry point for the analytics aggregator, which would
 * otherwise read 100+ historical DBs with the old (pre-v1.0.130) schema
 * and lose every signal (not just bytes_avoided) because the SELECT
 * statement references columns that don't exist on legacy schemas.
 *
 * Two open/close cycles in the worst case (one readonly probe to detect
 * legacy schema, one writable to migrate). For already-migrated DBs
 * (the common case after first read), this opens writable once and
 * exits without writing — cheaper than always-writable.
 */
export declare function ensureSessionEventsSchema(dbPath: string, DatabaseCtor: new (path: string, opts?: {
    readonly?: boolean;
}) => {
    pragma: (q: string) => Array<{
        name: string;
    }>;
    exec: (sql: string) => void;
    close: () => void;
}): void;
export declare class SessionDB extends SQLiteBase {
    /**
     * Cached prepared statements. Stored in a Map to avoid the JS private-field
     * inheritance issue where `#field` declarations in a subclass are not
     * accessible during base-class constructor calls.
     *
     * `declare` ensures TypeScript does NOT emit a field initializer at runtime.
     * Without `declare`, even `stmts!: Map<...>` emits `this.stmts = undefined`
     * after super() returns, wiping what prepareStatements() stored. The Map
     * is created inside prepareStatements() instead.
     */
    private stmts;
    constructor(opts?: {
        dbPath?: string;
    });
    /** Shorthand to retrieve a cached statement. */
    private stmt;
    protected initSchema(): void;
    protected prepareStatements(): void;
    /**
     * Insert a session event with deduplication and FIFO eviction.
     *
     * Deduplication: skips if the same type + data_hash appears in the
     * last DEDUP_WINDOW events for this session.
     *
     * Eviction: if session exceeds MAX_EVENTS_PER_SESSION, evicts the
     * lowest-priority (then oldest) event.
     */
    insertEvent(sessionId: string, event: Omit<SessionEvent, "data_hash"> & {
        data_hash?: string;
    }, sourceHook?: string, attribution?: Partial<ProjectAttribution>, bytes?: EventBytes): void;
    /**
     * Bulk-insert N events in a SINGLE transaction.
     *
     * PostToolUse hooks emit 5–15 events per tool call. Calling insertEvent()
     * in a loop runs N transactions = N WAL commits = N fsync candidates,
     * which is painful on Windows NTFS where commit latency dominates.
     * One transaction = one commit, dedup/evict checks reuse cached statements.
     *
     * Cross-platform: uses the same WAL-mode transaction primitive as
     * insertEvent — behavior identical on macOS / Linux / Windows.
     */
    bulkInsertEvents(sessionId: string, events: SessionEvent[], sourceHook?: string, attributions?: Array<Partial<ProjectAttribution> | undefined>, bytesList?: Array<EventBytes | undefined>): void;
    /**
     * Retrieve events for a session with optional filtering.
     */
    getEvents(sessionId: string, opts?: {
        type?: string;
        minPriority?: number;
        limit?: number;
    }): StoredEvent[];
    /**
     * Get the total event count for a session.
     */
    getEventCount(sessionId: string): number;
    /**
     * Aggregate per-event byte accounting for a session.
     *
     * Returns the total bytes context-mode kept OUT of the model context
     * window (`bytesAvoided`) and the total it actually returned to the
     * model (`bytesReturned`). Both default to 0 for unknown sessions.
     *
     * Used by the Insight dashboard to render the "saved vs returned"
     * panel without scanning every event row in JS.
     */
    getEventBytesSummary(sessionId: string): {
        bytesAvoided: number;
        bytesReturned: number;
    };
    /**
     * Return the most recently attributed project dir for a session.
     */
    getLatestAttributedProjectDir(sessionId: string): string | null;
    /**
     * Look up the project_dir from session_meta as a last-resort fallback
     * for event attribution. Prevents project_dir='' orphans when the caller
     * (e.g. pi adapter) omits the attribution parameter.
     */
    _getSessionProjectDir(sessionId: string): string;
    /**
     * Search events by text query scoped to a project directory.
     *
     * Performs a case-insensitive LIKE search across the `data` and `category`
     * columns. An optional `source` parameter filters by exact category match.
     * Returns results ordered by monotonic id (chronological).
     *
     * Best-effort: returns empty array on any error.
     */
    searchEvents(query: string, limit: number, projectDir: string, source?: string): Array<{
        id: number;
        session_id: string;
        category: string;
        type: string;
        data: string;
        created_at: string;
    }>;
    /**
     * Return the distinct list of session ids whose events were attributed
     * to a given `project_dir`. Powers the ctx_search `project:` filter
     * (#737) via the 2-step IN-clause strategy — ATTACH DATABASE is avoided
     * because SQLite's WAL + ATTACH combination has known correctness
     * trade-offs flagged in the upstream docs.
     *
     * Backed by the `idx_session_events_project(session_id, project_dir)`
     * composite index, so 1000-session lookups complete in single-digit
     * milliseconds. Best-effort: returns `[]` on any error.
     */
    getSessionIdsForProject(projectDir: string): string[];
    /**
     * Ensure a session metadata entry exists. Idempotent (INSERT OR IGNORE).
     * `projectDir` is the session origin directory, not per-event attribution.
     */
    ensureSession(sessionId: string, projectDir: string): void;
    /**
     * Get session statistics/metadata.
     */
    getSessionStats(sessionId: string): SessionMeta | null;
    /**
     * Session rollup snapshot — 12 aggregate fields the analytics platform
     * stamps onto every outgoing event row (seed.ts shape parity).
     *
     * Called from session-loaders BEFORE `maybeForward`; the snapshot is
     * computed against the LOCAL SessionDB and threaded into the canonical
     * event so the platform-side Zod schema receives the rich shape without
     * the bridge ever hand-mapping fields (PRD §5.4 ABI passthrough).
     *
     * Returns zeroed defaults for unknown sessions — callers MUST tolerate
     * a snapshot from an empty session (first event into a fresh DB).
     */
    getSessionRollup(sessionId: string): SessionRollup;
    /**
     * Increment the compact_count for a session (tracks snapshot rebuilds).
     */
    incrementCompactCount(sessionId: string): void;
    /**
     * Upsert a resume snapshot for a session. Resets consumed flag on update.
     */
    upsertResume(sessionId: string, snapshot: string, eventCount?: number): void;
    /**
     * Retrieve the resume snapshot for a session.
     */
    getResume(sessionId: string): ResumeRow | null;
    /**
     * Mark the resume snapshot as consumed (already injected into conversation).
     */
    markResumeConsumed(sessionId: string): void;
    /**
     * Atomically claim the most recent unconsumed resume snapshot in this DB,
     * EXCLUDING any row that belongs to `currentSessionId`.
     *
     * `SessionDB` is sharded per project (see `resolveSessionDbPath` — SHA-256
     * of canonical project dir), so "this DB" already implies "this project".
     * The atomic
     * `UPDATE … RETURNING` ensures concurrent processes for the same project
     * cannot both inject the same snapshot (Mickey / PR #376 race).
     *
     * The `currentSessionId` parameter prevents self-injection: when a session
     * compacts mid-flight and produces its own row, that session's next chat
     * turn must NOT claim that row back (wasted tokens AND it would consume
     * the snapshot meant for the next fresh session).
     *
     * Pass an empty string to allow self-claim (legacy behaviour, only useful
     * in tests or one-off harnesses).
     *
     * Returns null when no unconsumed snapshot exists for any other session.
     */
    claimLatestUnconsumedResume(currentSessionId: string): {
        sessionId: string;
        snapshot: string;
    } | null;
    /**
     * Return the most recent session_id from session_meta, or null if none.
     * Used by the runtime to attach persistent counters to the right session
     * after a process restart.
     */
    getLatestSessionId(): string | null;
    /**
     * Increment the persistent tool-call counter for `tool` in `sessionId`.
     * Adds `bytesReturned` to the cumulative total. Idempotent across
     * SessionDB instances — counters survive process restart.
     */
    incrementToolCall(sessionId: string, tool: string, bytesReturned?: number): void;
    /**
     * Get aggregated tool-call stats for `sessionId`. Returns zero-stats
     * when the session has no recorded calls.
     */
    getToolCallStats(sessionId: string): ToolCallStats;
    /**
     * Delete all data for a session (events, meta, resume).
     */
    deleteSession(sessionId: string): void;
    /**
     * Remove sessions older than maxAgeDays. Returns the count of deleted sessions.
     */
    cleanupOldSessions(maxAgeDays?: number): number;
    /**
     * Delete event rows whose session_id has no matching session_meta row.
     *
     * Orphaned events accumulate when meta rows were aged out by an older
     * version of `cleanupOldSessions` but the matching events were left
     * behind (or when callers wrote events without a meta upsert). The Kimi
     * Code sessionstart hook calls this on every startup as a self-healing
     * step; surfacing it as a SessionDB method keeps the SQL definition in
     * one place instead of letting hook scripts reach through to
     * `db.db.exec(...)` and re-encode schema knowledge in mjs files.
     */
    pruneOrphanedEvents(): number;
}
export {};
