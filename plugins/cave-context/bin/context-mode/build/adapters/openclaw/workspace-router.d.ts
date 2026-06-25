/**
 * Extract the agent workspace path from tool call params.
 * Looks for /openclaw/workspace-<name> patterns in cwd, file_path, and command.
 * Returns the workspace root (e.g. "/openclaw/workspace-trainer") or null.
 */
export declare function extractWorkspace(params: Record<string, unknown>): string | null;
/**
 * Maps agent workspaces to sessionIds using sessionKey convention.
 * sessionKey pattern: "agent:<name>:main" → workspace "/openclaw/workspace-<name>"
 *
 * Why this exists alongside per-session closures:
 * Each register() call creates its own closure with its own sessionId, which
 * naturally isolates sessions. The WorkspaceRouter acts as a safety net for
 * after_tool_call events where OpenClaw may deliver the event to the wrong
 * closure (e.g. tool calls interleaving across agents). It resolves the correct
 * sessionId from workspace paths in tool params, falling back to the closure
 * sessionId when no workspace is detected.
 */
export declare class WorkspaceRouter {
    private map;
    /** Register a session from session_start event. */
    registerSession(sessionKey: string, sessionId: string): void;
    /** Remove a session (e.g. on command:stop). */
    removeSession(sessionKey: string): void;
    /** Resolve sessionId from tool call params. Returns null if no match. */
    resolveSessionId(params: Record<string, unknown>): string | null;
    /** Derive workspace path from sessionKey. */
    private workspaceFromKey;
}
