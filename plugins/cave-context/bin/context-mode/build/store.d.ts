/**
 * ContentStore — FTS5 BM25-based knowledge base for context-mode.
 *
 * Chunks markdown content by headings (keeping code blocks intact),
 * stores in SQLite FTS5, and retrieves via BM25-ranked search.
 *
 * Use for documentation, API references, and any content where
 * you need EXACT text later — not summaries.
 */
import { type WalkOptions } from "./store-directory.js";
type SourceMatchMode = "like" | "exact";
import type { IndexResult, SearchResult, StoreStats } from "./types.js";
export type { IndexResult, SearchResult, StoreStats } from "./types.js";
export declare function sanitizeQuery(query: string, mode?: "AND" | "OR"): string;
export declare function sanitizeTrigramQuery(query: string, mode?: "AND" | "OR"): string;
/**
 * Remove stale DB files from previous sessions whose processes no longer exist.
 */
export declare function cleanupStaleDBs(): number;
/**
 * Clean up stale per-project content store DBs older than maxAgeDays.
 * Scans the given directory for *.db files and checks mtime.
 * Also detects zombie processes holding WAL locks — if a WAL file exists
 * but the owning PID is dead, the DB files are cleaned up regardless of age.
 */
export declare function cleanupStaleContentDBs(contentDir: string, maxAgeDays: number): number;
export declare class ContentStore {
    #private;
    static readonly OPTIMIZE_EVERY = 50;
    static readonly FUZZY_CACHE_SIZE = 256;
    constructor(dbPath?: string);
    /** Delete this session's DB files. Call on process exit. */
    cleanup(): void;
    /**
     * Register a deny-policy checker. When set, #refreshStaleSources
     * calls it before re-reading any file_path during auto-refresh.
     * Returning `true` causes the source to be skipped (kept in cache,
     * not re-indexed). server.ts wires this to the Read deny patterns.
     */
    setDenyChecker(fn: ((filePath: string) => boolean) | undefined): void;
    index(options: {
        content?: string;
        path?: string;
        source?: string;
        /**
         * Optional FK metadata recorded on each indexed chunk so per-session
         * honest-savings stats can join chunks → session_events. When omitted,
         * chunks fall back to empty-string columns (legacy behaviour).
         */
        attribution?: {
            sessionId?: string;
            eventId?: string;
        };
    }): IndexResult;
    /**
     * Index every file under a directory by walking it with `walkDirectory` and
     * delegating each discovered file to `this.index({ path })`. The per-file
     * `openSync + fstatSync.isFile()` security gate at line ~845 stays active
     * for every file — directory support never bypasses the TOCTOU defense
     * from #442 round-3.
     *
     * Reported by @matiasduartee in #687.
     */
    indexDirectory(opts: {
        path: string;
        source?: string;
        attribution?: {
            sessionId?: string;
            eventId?: string;
        };
        /** Optional per-file deny check — runs INSIDE the walk loop so a denied
         *  file does not even open a fd. Returns true to deny. */
        perFileDeny?: (absPath: string) => boolean;
    } & WalkOptions): {
        filesIndexed: number;
        totalChunks: number;
        capped: boolean;
        totalSeen: number;
        denied: number;
        failed: number;
        label: string;
    };
    /**
     * Index plain-text output (logs, build output, test results) by splitting
     * into fixed-size line groups. Unlike markdown indexing, this does not
     * look for headings — it chunks by line count with overlap.
     */
    indexPlainText(content: string, source: string, linesPerChunk?: number, attribution?: {
        sessionId?: string;
        eventId?: string;
    }): IndexResult;
    /**
     * Index JSON content by walking the object tree and using key paths
     * as chunk titles (analogous to heading hierarchy in markdown). Objects
     * recurse by key; arrays batch items by size.
     *
     * Falls back to `indexPlainText` if the content is not valid JSON.
     */
    indexJSON(content: string, source: string, maxChunkBytes?: number, attribution?: {
        sessionId?: string;
        eventId?: string;
    }): IndexResult;
    search(query: string, limit?: number, source?: string, mode?: "AND" | "OR", contentType?: "code" | "prose", sourceMatchMode?: SourceMatchMode): SearchResult[];
    searchTrigram(query: string, limit?: number, source?: string, mode?: "AND" | "OR", contentType?: "code" | "prose", sourceMatchMode?: SourceMatchMode): SearchResult[];
    fuzzyCorrect(query: string): string | null;
    searchWithFallback(query: string, limit?: number, source?: string, contentType?: "code" | "prose", sourceMatchMode?: SourceMatchMode, sessionIdAllowSet?: Set<string>): SearchResult[];
    /** Number of sources auto-refreshed in the last searchWithFallback call. */
    lastRefreshCount: number;
    getSourceMeta(label: string): {
        label: string;
        chunkCount: number;
        codeChunkCount: number;
        indexedAt: string;
        filePath: string | null;
        contentHash: string | null;
    } | null;
    listSources(): Array<{
        label: string;
        chunkCount: number;
    }>;
    /**
     * Aggregate snapshot of the persistent content store. Returns total
     * chunk count, source count, and the most recent indexed_at timestamp.
     * Used by ctx_stats so callers can see observability state in the same
     * round trip instead of inferring it from snapshot diffs.
     */
    getIndexState(): {
        totalChunks: number;
        totalSources: number;
        lastIndexedAt?: string;
    };
    /**
     * Get all chunks for a given source by ID — bypasses FTS5 MATCH entirely.
     * Use this for inventory/listing where you need all sections, not search.
     */
    getChunksBySource(sourceId: number): SearchResult[];
    getDistinctiveTerms(sourceId: number, maxTerms?: number): string[];
    getStats(): StoreStats;
    /**
     * Delete sources (and their chunks) older than maxAgeDays.
     * Returns count of deleted sources.
     */
    cleanupStaleSources(maxAgeDays: number): number;
    /** Get DB file size in bytes. */
    getDBSizeBytes(): number;
    close(): void;
}
