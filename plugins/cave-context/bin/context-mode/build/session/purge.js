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
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadDatabase } from "../db-base.js";
import { getWorktreeSuffix, hashProjectDirCanonical, hashProjectDirLegacy, SessionDB, } from "./db.js";
/** Canonical SQLite sidecar suffixes. The empty string is the main DB. */
const SQLITE_SIDECARS = ["", "-wal", "-shm"];
/** Try to unlink one path; report success without throwing on ENOENT etc. */
function tryUnlink(p, wipedPaths) {
    try {
        unlinkSync(p);
        wipedPaths.push(p);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Unlink a SQLite db at `path` plus its `-wal` / `-shm` sidecars.
 * Returns true when the MAIN db file (not a sidecar) was removed.
 */
function tryUnlinkSqliteTriple(path, wipedPaths) {
    let mainRemoved = false;
    for (const suffix of SQLITE_SIDECARS) {
        const removed = tryUnlink(`${path}${suffix}`, wipedPaths);
        if (removed && suffix === "")
            mainRemoved = true;
    }
    return mainRemoved;
}
/**
 * Wipe every session-related on-disk artifact for `projectDir`.
 *
 * This function never throws on missing files (a fresh install is a no-op).
 * It throws only when given an invalid argument (e.g. `legacyContentDir`
 * without `contentHash`), which is a programmer bug not a runtime concern.
 */
export function purgeSession(opts) {
    const { projectDir, sessionsDir, storePath, contentDir, legacyContentDir, contentHash, sessionId, scope } = opts;
    const deleted = [];
    const wipedPaths = [];
    // Issue #520 — scope discipline.
    // Resolve effective scope: explicit `scope` wins; otherwise infer
    // "session" iff sessionId is given, else "project".
    const effectiveScope = scope ?? (sessionId ? "session" : "project");
    if (effectiveScope === "session" && !sessionId) {
        throw new TypeError("purgeSession: scope:'session' requires sessionId. " +
            "Pass scope:'project' for the legacy whole-project wipe.");
    }
    // ── Session-scoped path (issue #520). ─────────────────────────────────
    // Wipe ONLY this sessionId's rows from the project's SessionDB. The DB
    // file itself, the events.md sidecar, the FTS5 store, and the stats
    // file are all left intact — those are project-scoped concerns. The
    // label "session rows for <id>" appears once when at least one row was
    // removed, mirroring the project-scoped UI contract.
    if (effectiveScope === "session" && sessionId) {
        const worktreeSuffix = getWorktreeSuffix(projectDir);
        const canonicalHash = hashProjectDirCanonical(projectDir);
        const legacyHash = hashProjectDirLegacy(projectDir);
        const hashes = canonicalHash === legacyHash
            ? [canonicalHash]
            : [canonicalHash, legacyHash];
        let rowsRemoved = false;
        for (const h of hashes) {
            const dbPath = join(sessionsDir, `${h}${worktreeSuffix}.db`);
            if (!existsSync(dbPath))
                continue;
            let db = null;
            try {
                db = new SessionDB({ dbPath });
                const before = db.getEvents(sessionId).length;
                db.deleteSession(sessionId);
                if (before > 0)
                    rowsRemoved = true;
            }
            catch {
                // Best-effort — corrupt DB is logged elsewhere; do not block purge.
            }
            finally {
                // close() releases the handle WITHOUT deleting the file —
                // this is what makes the scoped wipe non-destructive at the
                // file-system level. Using cleanup() here would erase the
                // entire DB (main + WAL + SHM), defeating per-session scope.
                try {
                    db?.close();
                }
                catch { /* best effort */ }
            }
        }
        if (rowsRemoved)
            deleted.push(`session rows for ${sessionId}`);
        // Per-session FTS5 chunk wipe. The chunks table has a `session_id
        // UNINDEXED` column (src/store.ts schema). The public index() path
        // currently inserts NULL — but a future per-session-tagged path
        // (e.g. tool-call indexing keyed to a session) will populate it,
        // and the SQL contract here keeps that future correct from day one.
        // Today this is a safe no-op against existing data.
        //
        // Caller is responsible for closing any persistent ContentStore
        // handle BEFORE invoking purgeSession (Windows file lock). The
        // ctx_purge handler does this via _store?.cleanup() before delegating.
        const ftsTargets = [];
        if (storePath && existsSync(storePath))
            ftsTargets.push(storePath);
        if (contentDir) {
            const canonicalH = hashProjectDirCanonical(projectDir);
            const legacyH = hashProjectDirLegacy(projectDir);
            const hh = canonicalH === legacyH ? [canonicalH] : [canonicalH, legacyH];
            for (const h of hh) {
                const p = join(contentDir, `${h}.db`);
                if (existsSync(p) && !ftsTargets.includes(p))
                    ftsTargets.push(p);
            }
        }
        let chunksRemoved = false;
        for (const path of ftsTargets) {
            try {
                const Database = loadDatabase();
                const fts = new Database(path, { timeout: 30000 });
                try {
                    const before = fts.prepare("SELECT COUNT(*) AS c FROM chunks WHERE session_id = ?").get(sessionId).c;
                    fts.prepare("DELETE FROM chunks WHERE session_id = ?").run(sessionId);
                    fts.prepare("DELETE FROM chunks_trigram WHERE session_id = ?").run(sessionId);
                    if (before > 0)
                        chunksRemoved = true;
                }
                finally {
                    try {
                        fts.close();
                    }
                    catch { /* best effort */ }
                }
            }
            catch {
                // Best-effort — schema mismatch / corrupt DB / missing FTS5 must not
                // block the per-session SessionDB wipe that already succeeded.
            }
        }
        if (chunksRemoved)
            deleted.push(`FTS5 chunks for ${sessionId}`);
        return { deleted, wipedPaths };
    }
    // ── 1. Knowledge base FTS5 store (per-platform). ──────────────────────
    // Two input modes:
    //   - `storePath`: single absolute path; pre-resolved by caller. Wipes
    //     exactly that file plus -wal / -shm sidecars. Back-compat path.
    //   - `contentDir`: directory; purgeSession derives BOTH canonical and
    //     legacy raw-casing variants of the FTS5 store filename (matches
    //     the case-fold migration pattern from `resolveContentStorePath`)
    //     and sweeps each with sidecars. Recommended for new callers.
    // Both inputs may be supplied; paths are de-duped via the unlink-or-fail
    // semantics of `tryUnlinkSqliteTriple`. The "knowledge base (FTS5)"
    // label appears at most once.
    let storeFound = false;
    if (storePath && tryUnlinkSqliteTriple(storePath, wipedPaths))
        storeFound = true;
    if (contentDir) {
        const canonicalHash = hashProjectDirCanonical(projectDir);
        const legacyHash = hashProjectDirLegacy(projectDir);
        const storeHashes = canonicalHash === legacyHash
            ? [canonicalHash]
            : [canonicalHash, legacyHash];
        for (const h of storeHashes) {
            const path = join(contentDir, `${h}.db`);
            if (tryUnlinkSqliteTriple(path, wipedPaths))
                storeFound = true;
        }
    }
    if (storeFound)
        deleted.push("knowledge base (FTS5)");
    // ── 2. Legacy shared content DB at ~/.context-mode/content/<hash>.db.
    // Same reasoning as (1) — single hash, legacy code-path only.
    if (legacyContentDir) {
        if (!contentHash) {
            throw new TypeError("purgeSession: contentHash is required when legacyContentDir is provided");
        }
        const legacyPath = join(legacyContentDir, `${contentHash}.db`);
        tryUnlinkSqliteTriple(legacyPath, wipedPaths);
        // No user-facing label — this is a silent legacy cleanup.
    }
    // ── 3. Session-events kinds at BOTH canonical AND legacy hashes. ─────
    // This is the bug fix: the prior handler only dual-hashed the .db file
    // (after migration commit a32cc29). events.md and .cleanup were left
    // single-hash, so a casing-drift project on macOS/Windows could leak
    // orphan files past a purge. We now sweep all three uniformly.
    const worktreeSuffix = getWorktreeSuffix(projectDir);
    const canonicalHash = hashProjectDirCanonical(projectDir);
    const legacyHash = hashProjectDirLegacy(projectDir);
    const hashes = canonicalHash === legacyHash
        ? [canonicalHash]
        : [canonicalHash, legacyHash];
    let sessDbFound = false;
    let eventsFound = false;
    for (const h of hashes) {
        const base = join(sessionsDir, `${h}${worktreeSuffix}`);
        if (tryUnlinkSqliteTriple(`${base}.db`, wipedPaths))
            sessDbFound = true;
        if (tryUnlink(`${base}-events.md`, wipedPaths))
            eventsFound = true;
        tryUnlink(`${base}.cleanup`, wipedPaths); // no user-facing label
    }
    if (sessDbFound)
        deleted.push("session events DB");
    if (eventsFound)
        deleted.push("session events markdown");
    return { deleted, wipedPaths };
}
