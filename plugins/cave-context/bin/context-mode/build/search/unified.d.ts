/**
 * Unified multi-source search — merges ContentStore, SessionDB, and
 * auto-memory results into a single ranked or chronological result set.
 *
 * Used by ctx_search when sort="timeline" to search across all sources,
 * or sort="relevance" (default) for ContentStore-only BM25 search.
 */
import type { ContentStore } from "../store.js";
import type { SessionDB } from "../session/db.js";
import { type AutoMemoryAdapter } from "./auto-memory.js";
export interface UnifiedSearchResult {
    title: string;
    content: string;
    source: string;
    origin: "current-session" | "prior-session" | "auto-memory";
    timestamp?: string;
    rank?: number;
    matchLayer?: string;
    highlighted?: string;
    contentType?: "code" | "prose";
}
export interface SearchAllSourcesOpts {
    query: string;
    limit: number;
    store: ContentStore;
    sort?: "relevance" | "timeline";
    source?: string;
    contentType?: "code" | "prose";
    sessionDB?: SessionDB | null;
    projectDir?: string;
    configDir?: string;
    /** Detected platform adapter — used for adapter-aware auto-memory. */
    adapter?: AutoMemoryAdapter;
    /**
     * Per-project scope for the ContentStore filter (#737). Only honoured
     * when a `sessionDB` is also supplied (the 2-step IN-clause needs the
     * SessionDB to translate `project_dir` → list of session ids).
     *
     *   - `undefined` — no project filter, today's behaviour.
     *   - `null`      — cross-project recall in shared-DB mode (also no filter).
     *   - `string`    — restrict ContentStore results to chunks attributed to
     *                   session ids whose events match this `project_dir`,
     *                   plus legacy `session_id=''` chunks (public surface).
     */
    projectScope?: string | null;
}
/**
 * Search across all available sources.
 *
 * - sort="relevance" (default): BM25-ranked results from ContentStore only.
 * - sort="timeline": chronological merge of ContentStore + SessionDB + auto-memory.
 *
 * Errors in any single source are caught and logged — partial results
 * are always returned.
 */
export declare function searchAllSources(opts: SearchAllSourcesOpts): UnifiedSearchResult[];
