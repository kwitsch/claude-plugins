/**
 * Snapshot builder — converts stored SessionEvents into a reference-based
 * XML resume snapshot.
 *
 * Pure functions only. No database access, no file system, no side effects.
 *
 * The output XML is injected into the LLM's context after a compact event to
 * restore session awareness. Instead of truncated inline data, each section
 * contains a natural summary plus a runnable search tool call that retrieves
 * full details from the indexed knowledge base on demand.
 *
 * Zero truncation. Zero information loss. Full data lives in SessionDB;
 * the snapshot is a table of contents.
 */
/** Stored event as read from SessionDB. */
export interface StoredEvent {
    type: string;
    category: string;
    data: string;
    priority: number;
    created_at?: string;
}
export interface BuildSnapshotOpts {
    maxBytes?: number;
    compactCount?: number;
    searchTool?: string;
}
/**
 * Render <task_state> from task events.
 * Reconstructs the full task list from create/update events,
 * filters out completed tasks, and renders only pending/in-progress work.
 *
 * TaskCreate events have `{ subject }`, TaskUpdate events have `{ taskId, status }`.
 * Match by chronological order: creates[0] -> lowest taskId from updates.
 */
export declare function renderTaskState(taskEvents: StoredEvent[]): string;
/**
 * Build a reference-based resume snapshot XML string from stored session events.
 *
 * Algorithm:
 * 1. Group events by category
 * 2. For each non-empty category, build a summary section with a runnable
 *    search tool call containing exact queries for full details
 * 3. Assemble ALL non-empty sections — no priority dropping, no byte budget
 */
export declare function buildResumeSnapshot(events: StoredEvent[], opts?: BuildSnapshotOpts): string;
