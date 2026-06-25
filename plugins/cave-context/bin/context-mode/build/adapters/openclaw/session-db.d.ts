/**
 * OpenClawSessionDB — OpenClaw-specific extension of SessionDB.
 *
 * Adds session_key mapping (openclaw_session_map table) and session
 * rename support needed for OpenClaw's gateway restart re-keying.
 *
 * The shared SessionDB remains unaware of session_key; all OpenClaw-specific
 * session mapping lives here.
 */
import { SessionDB } from "../../session/db.js";
/** Row from the openclaw_session_map table. */
export interface SessionMapRow {
    session_key: string;
    session_id: string;
    created_at: string;
}
export declare class OpenClawSessionDB extends SessionDB {
    /**
     * OpenClaw-specific prepared statements, separate from the parent's
     * private statement cache. Created in prepareStatements() after
     * super.prepareStatements() finishes.
     *
     * `declare` prevents TypeScript from emitting a field initializer
     * that would wipe the value set during the base constructor's
     * prepareStatements() call chain.
     */
    private ocStmts;
    protected initSchema(): void;
    protected prepareStatements(): void;
    /** Shorthand to retrieve an OpenClaw-specific cached statement. */
    private oc;
    /**
     * Ensure a session metadata entry exists with an associated session_key.
     * Calls the parent's 2-param ensureSession and also records the mapping
     * in openclaw_session_map.
     */
    ensureSessionWithKey(sessionId: string, projectDir: string, sessionKey: string): void;
    /**
     * Get the session_id of the most recently mapped session for a given sessionKey.
     * Returns null if no sessions exist for that key.
     */
    getMostRecentSession(sessionKey: string): string | null;
    /**
     * Rename a session ID in-place across all tables (session_meta, session_events,
     * session_resume, openclaw_session_map), preserving all events, metadata,
     * and resume snapshots. Used when OpenClaw re-keys session IDs on gateway
     * restart so accumulated events survive the re-key.
     */
    renameSession(oldId: string, newId: string): void;
    /**
     * Remove a session_key mapping from openclaw_session_map.
     * Called on command:stop to clean up agent session tracking.
     */
    removeSessionKey(sessionKey: string): void;
}
