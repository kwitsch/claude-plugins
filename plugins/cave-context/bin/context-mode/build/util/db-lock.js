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
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
/** User-facing failure used by SQLiteBase to surface the contention. */
export class DatabaseLockedError extends Error {
    pid;
    dbPath;
    constructor(pid, dbPath) {
        super(`Another context-mode server is already running (PID: ${pid}). ` +
            `Stop it before starting a new instance.`);
        this.name = "DatabaseLockedError";
        this.pid = pid;
        this.dbPath = dbPath;
    }
}
/**
 * Liveness probe — a 6-line copy of `store.ts:187 isProcessAlive`.
 * Sends signal 0 (no-op kill) which only verifies that the kernel
 * recognizes the PID + that the caller has permission to signal it.
 *
 * Copied (not imported) so this module stays leaf-level and `db-base.ts`
 * does not pick up a transitive dependency on `store.ts` — `store.ts`
 * already imports from `db-base.ts`, so the reverse would create a
 * circular dep that breaks under bun:sqlite's lazy load path.
 */
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function lockPathFor(dbPath) {
    return `${dbPath}.lock`;
}
/**
 * tmpdir skip-gate — per-process DBs (e.g. defaultDBPath() output) embed
 * `process.pid` so cross-instance contention is impossible by
 * construction. We never want to install a lockfile on the test runner's
 * tmp scratch path either.
 */
function isUnderTmpdir(dbPath) {
    // Trailing-slash normalize — tmpdir() may or may not include it on the
    // current platform, and dbPath may be exactly tmpdir() when callers
    // join() with no separator (rare but cheap to guard).
    const tmp = tmpdir();
    return dbPath === tmp || dbPath.startsWith(tmp + "/") || dbPath.startsWith(tmp + "\\");
}
/**
 * Atomically claim the lockfile for `dbPath`. Throws `DatabaseLockedError`
 * if another live process holds it. Silently claims stale lockfiles whose
 * owning PID is dead.
 */
export function acquireDbLock(opts) {
    const { dbPath } = opts;
    if (isUnderTmpdir(dbPath))
        return { skipped: true };
    const lockPath = lockPathFor(dbPath);
    const ownPid = String(process.pid);
    // Fast path: O_EXCL atomic create — succeeds iff the lockfile did not
    // exist. This is the single race-free moment that grants ownership.
    try {
        writeFileSync(lockPath, ownPid, { flag: "wx" });
        return { skipped: false };
    }
    catch (err) {
        const code = err?.code;
        if (code !== "EEXIST")
            throw err;
        // Fall through to liveness check.
    }
    // Slow path: lockfile exists. Read the PID, probe liveness.
    let existingPidStr;
    try {
        existingPidStr = readFileSync(lockPath, "utf-8").trim();
    }
    catch {
        // Lockfile vanished between EEXIST and read — race won by another
        // claimer that already finished cleanup. Retry once via the fast
        // path; if even that fails, surface as locked (best-effort).
        try {
            writeFileSync(lockPath, ownPid, { flag: "wx" });
            return { skipped: false };
        }
        catch {
            throw new DatabaseLockedError(0, dbPath);
        }
    }
    const existingPid = Number.parseInt(existingPidStr, 10);
    if (Number.isFinite(existingPid) && existingPid > 0 && isProcessAlive(existingPid)) {
        throw new DatabaseLockedError(existingPid, dbPath);
    }
    // Stale lockfile — owning PID is dead (or unparseable). Claim it.
    // We do NOT use { flag: 'wx' } here because we deliberately want to
    // overwrite the dead-PID record. Then re-read to confirm we won the
    // race against any other process also seeing the same stale lock.
    writeFileSync(lockPath, ownPid, { flag: "w" });
    let writtenPid;
    try {
        writtenPid = Number.parseInt(readFileSync(lockPath, "utf-8").trim(), 10);
    }
    catch {
        // Vanished again — extremely unlikely. Surface as locked rather than
        // proceeding with no guarantee.
        throw new DatabaseLockedError(0, dbPath);
    }
    if (writtenPid !== process.pid) {
        // Lost the stale-claim race to another concurrent claimer.
        throw new DatabaseLockedError(writtenPid, dbPath);
    }
    return { skipped: false };
}
/**
 * Drop the lockfile for `dbPath`. Swallows all errors so callers can
 * always invoke this in a finally / cleanup path without try/catch —
 * mirrors the shape of `db-base.ts closeDB`.
 *
 * Skipped (no-op) when `dbPath` is under tmpdir — symmetric with
 * `acquireDbLock`'s skip-gate.
 */
export function releaseDbLock(opts) {
    const { dbPath } = opts;
    if (isUnderTmpdir(dbPath))
        return;
    try {
        unlinkSync(lockPathFor(dbPath));
    }
    catch {
        // Already gone, permission denied, etc. — best-effort.
    }
}
