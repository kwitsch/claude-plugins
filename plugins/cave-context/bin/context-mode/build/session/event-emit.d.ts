/**
 * event-emit — Phase 5+7 of D2 PRD (stats-event-driven-architecture)
 *
 * Server-side helpers that record sandbox / index / cache work into
 * `session_events` with the new `bytes_avoided` / `bytes_returned`
 * columns so the renderer can compute the real $ saved instead of the
 * conservative `events × 256` token estimate.
 *
 * Design notes
 * ────────────
 * - Uses the public `SessionDB.insertEvent(... , bytes)` API the schema
 *   engineer extended in this branch — same dedup + FIFO eviction +
 *   transaction wrapping you'd get from any other event source.
 * - Best-effort error swallowing matches `persistToolCallCounter` in
 *   `persist-tool-calls.ts`. A stats-side failure must NEVER break the
 *   parent MCP tool call.
 * - Resolves the latest `session_id` from `session_meta` so the wiring
 *   in `server.ts` is `setImmediate(() => emit*({...}))` — no need to
 *   plumb session ids through every handler.
 */
/**
 * Record a `ctx_execute` / `ctx_execute_file` / `ctx_batch_execute` run.
 * `bytesReturned` is the size of the stdout text the user actually saw —
 * the rest of the sandbox output stayed out of context.
 */
export declare function emitSandboxExecuteEvent(opts: {
    sessionDbPath: string;
    toolName: string;
    bytesReturned: number;
}): void;
/**
 * Record a `ctx_index` / `trackIndexed` write — content kept out of
 * context by being chunked into FTS5 instead of returned inline.
 */
export declare function emitIndexWriteEvent(opts: {
    sessionDbPath: string;
    source: string;
    bytesAvoided: number;
}): void;
/**
 * Record a `ctx_fetch_and_index` TTL cache hit — bytes the user would
 * have spent re-fetching the same URL within the 24h cache window.
 */
export declare function emitCacheHitEvent(opts: {
    sessionDbPath: string;
    source: string;
    bytesAvoided: number;
}): void;
