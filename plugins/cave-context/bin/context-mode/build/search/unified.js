/**
 * Unified multi-source search — merges ContentStore, SessionDB, and
 * auto-memory results into a single ranked or chronological result set.
 *
 * Used by ctx_search when sort="timeline" to search across all sources,
 * or sort="relevance" (default) for ContentStore-only BM25 search.
 */
import { searchAutoMemory } from "./auto-memory.js";
const DEBUG = process.env.DEBUG?.includes("context-mode");
// ─────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────
/**
 * Search across all available sources.
 *
 * - sort="relevance" (default): BM25-ranked results from ContentStore only.
 * - sort="timeline": chronological merge of ContentStore + SessionDB + auto-memory.
 *
 * Errors in any single source are caught and logged — partial results
 * are always returned.
 */
export function searchAllSources(opts) {
    const { query, limit, store, sort = "relevance", source, contentType, sessionDB, projectDir, configDir, adapter, projectScope, } = opts;
    const results = [];
    // Capture session start time once — used as proxy for ContentStore items
    // (we don't know exact indexing time, but all content is from current session)
    const sessionStartTime = new Date().toISOString();
    // ── Project scope (#737) ──
    // Resolve the per-project session-id allow-set ONCE, before the
    // ContentStore call. `projectScope === null` means cross-project recall —
    // an explicit "no filter" choice surfaced by the ctx_search caller — and
    // `undefined` falls back to today's unfiltered behaviour.
    let sessionIdAllowSet;
    if (typeof projectScope === "string" && sessionDB) {
        try {
            sessionIdAllowSet = new Set(sessionDB.getSessionIdsForProject(projectScope));
        }
        catch (e) {
            if (DEBUG)
                process.stderr.write(`[ctx] getSessionIdsForProject failed: ${e}\n`);
        }
    }
    // ── Source 1: ContentStore (always, both modes) ──
    try {
        const storeResults = store.searchWithFallback(query, limit, source, contentType, "like", sessionIdAllowSet);
        results.push(...storeResults.map((r) => ({
            title: r.title,
            content: r.content,
            source: r.source,
            origin: "current-session",
            timestamp: r.timestamp || sessionStartTime,
            rank: r.rank,
            matchLayer: r.matchLayer,
            highlighted: r.highlighted,
            contentType: r.contentType,
        })));
    }
    catch (e) {
        if (DEBUG)
            process.stderr.write(`[ctx] ContentStore search failed: ${e}\n`);
    }
    // ── Sources 2+3: timeline mode only ──
    if (sort === "timeline") {
        // Source 2: SessionDB — prior session events
        try {
            if (sessionDB) {
                const dbResults = sessionDB.searchEvents(query, limit, projectDir || "", source);
                results.push(...dbResults.map((r) => ({
                    title: `[${r.category}] ${r.type}`,
                    content: r.data,
                    source: "prior-session",
                    origin: "prior-session",
                    timestamp: r.created_at,
                })));
            }
        }
        catch (e) {
            if (DEBUG)
                process.stderr.write(`[ctx] SessionDB search failed: ${e}\n`);
        }
        // Source 3: Auto-memory
        try {
            const memResults = searchAutoMemory([query], limit, projectDir, configDir, adapter);
            results.push(...memResults);
        }
        catch (e) {
            if (DEBUG)
                process.stderr.write(`[ctx] auto-memory search failed: ${e}\n`);
        }
    }
    // ── Normalize timestamps for consistent sorting ──
    // SQLite datetime('now') → "YYYY-MM-DD HH:MM:SS" (no T, no Z)
    // ISO → "YYYY-MM-DDTHH:MM:SS.sssZ"
    for (const r of results) {
        if (r.timestamp && !r.timestamp.includes("T")) {
            r.timestamp = r.timestamp.replace(" ", "T") + "Z";
        }
    }
    // ── Sort ──
    if (sort === "timeline") {
        results.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
    }
    return results.slice(0, limit);
}
