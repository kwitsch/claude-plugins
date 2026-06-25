/**
 * AnalyticsEngine — Runtime savings + session continuity reporting.
 *
 * Computes context-window savings from runtime stats and queries
 * session continuity data from SessionDB.
 *
 * Usage:
 *   const engine = new AnalyticsEngine(sessionDb);
 *   const report = engine.queryAll(runtimeStats);
 */
/** Database adapter — anything with a prepare() method (better-sqlite3, bun:sqlite, etc.) */
export interface DatabaseAdapter {
    prepare(sql: string): {
        run(...params: unknown[]): unknown;
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
    };
}
/** Context savings result (#1) */
export interface ContextSavings {
    rawBytes: number;
    contextBytes: number;
    savedBytes: number;
    savedPercent: number;
}
/** Think in code comparison result (#2) */
export interface ThinkInCodeComparison {
    fileBytes: number;
    outputBytes: number;
    ratio: number;
}
/** Tool-level savings result (#3) */
export interface ToolSavingsRow {
    tool: string;
    rawBytes: number;
    contextBytes: number;
    savedBytes: number;
}
/** Sandbox I/O result (#19) */
export interface SandboxIO {
    inputBytes: number;
    outputBytes: number;
}
/** MCP tool usage row — concurrency stats for batch-style tools. */
export interface McpToolUsageRow {
    tool_name: string;
    calls: number;
    median_concurrency: number | null;
    max_concurrency: number | null;
}
/**
 * Conversation-scoped stats — aggregated from `session_events` for a single
 * `session_id` across every worktree DB plus the compact-rescue snapshot from
 * `session_resume`. Replaces the broken in-memory `tool_call_counter` that
 * only saw `ctx_*` MCP calls and reset to 0 every time the MCP server PID
 * changed (which is what made hours-of-work conversations show "1 call · 5 KB").
 */
export interface ConversationStats {
    /** session_id this aggregate covers (the current Claude Code conversation). */
    sessionId: string;
    /** Total event count for this session_id, summed across all DBs. */
    events: number;
    /** Distinct DB files this session_id appeared in (a rotation indicator). */
    dbCount: number;
    /** Wall-clock days from first to last event. Captures real activity length. */
    daysAlive: number;
    /** Bytes restored from the compact snapshot for this session_id. 0 if no compact. */
    snapshotBytes: number;
    /** Number of compact snapshots consumed for this session_id. */
    snapshotsConsumed: number;
    /** Category breakdown for this session_id. */
    byCategory: Array<{
        category: string;
        count: number;
        label: string;
    }>;
    /**
     * Earliest event timestamp (ms epoch) for this session_id across every DB.
     * Used by the section-1 "started X" line in the narrative renderer. 0 when
     * the session has no events yet. Optional for back-compat with older
     * callers / fixtures that pre-date the narrative layout.
     */
    firstEventMs?: number;
    /** Latest event timestamp (ms epoch) — pairs with firstEventMs. */
    lastEventMs?: number;
    /**
     * Wall-clock timestamp of the most recent /compact rescue for this session.
     * Drives the "On <datetime>, /compact fired" line in section 1. Undefined
     * when the conversation has never been compacted.
     */
    lastRescueMs?: number;
    /**
     * Per-day capture breakdown for the section-1 horizontal timeline. Each
     * entry is one calendar day (UTC midnight ms) with that day's event count
     * + optional rescueBytes when /compact fired on that day. Empty array
     * when no events recorded yet.
     */
    byDay?: Array<{
        ms: number;
        count: number;
        rescueBytes?: number;
    }>;
}
/** Runtime stats tracked by server.ts during a live session. */
export interface RuntimeStats {
    bytesReturned: Record<string, number>;
    bytesIndexed: number;
    bytesSandboxed: number;
    calls: Record<string, number>;
    sessionStart: number;
    cacheHits: number;
    cacheMisses?: number;
    cacheBytesSaved: number;
}
/**
 * Index observability snapshot — point-in-time view of the persistent
 * content store. Optional input to `formatReport` so callers that don't
 * have store access (or don't want the extra DB hit) can omit it.
 */
export interface IndexState {
    totalChunks: number;
    totalSources: number;
    lastIndexedAt?: string;
}
/** Unified report combining runtime stats, DB analytics, and continuity data. */
export interface FullReport {
    /** Runtime context savings (passed in, not from DB) */
    savings: {
        processed_kb: number;
        entered_kb: number;
        saved_kb: number;
        pct: number;
        savings_ratio: number;
        by_tool: Array<{
            tool: string;
            calls: number;
            context_kb: number;
            tokens: number;
        }>;
        total_calls: number;
        total_bytes_returned: number;
        kept_out: number;
        total_processed: number;
    };
    cache?: {
        hits: number;
        misses: number;
        hit_rate: number;
        bytes_saved: number;
        ttl_hours_left: number;
        total_with_cache: number;
        total_savings_ratio: number;
    };
    /** Session metadata from SessionDB */
    session: {
        id: string;
        uptime_min: string;
    };
    /** Session continuity data */
    continuity: {
        total_events: number;
        by_category: Array<{
            category: string;
            count: number;
            label: string;
            preview: string;
            why: string;
        }>;
        compact_count: number;
        resume_ready: boolean;
    };
    /** Persistent project memory — all events across all sessions */
    projectMemory: {
        total_events: number;
        session_count: number;
        by_category: Array<{
            category: string;
            count: number;
            label: string;
        }>;
    };
}
/**
 * Human-readable labels for event categories.
 *
 * Each label is a sentence-case phrase that reads like a benefit, not a
 * column name. The user shouldn't see raw schema words like "external-ref"
 * or "agent-finding" — those leak the database into the UX. When a new
 * category lands without an entry here, the renderer falls through to the
 * raw category id; that's a copy-debt signal, fix it here.
 */
export declare const categoryLabels: Record<string, string>;
/** Explains why each category matters for continuity. */
export declare const categoryHints: Record<string, string>;
export declare class AnalyticsEngine {
    private readonly db;
    /**
     * Create an AnalyticsEngine.
     *
     * Accepts either a SessionDB instance (extracts internal db via
     * the protected getter — use the static fromDB helper for raw adapters)
     * or any object with a prepare() method for direct usage.
     */
    constructor(db: DatabaseAdapter);
    /**
     * #1 Context Savings Total — bytes kept out of context window.
     *
     * Stub: requires server.ts to accumulate rawBytes and contextBytes
     * during a live session. Call with tracked values.
     */
    static contextSavingsTotal(rawBytes: number, contextBytes: number): ContextSavings;
    /**
     * #2 Think in Code Comparison — ratio of file size to sandbox output size.
     *
     * Stub: requires server.ts tracking of execute/execute_file calls.
     */
    static thinkInCodeComparison(fileBytes: number, outputBytes: number): ThinkInCodeComparison;
    /**
     * #3 Tool Savings — per-tool breakdown of context savings.
     *
     * Stub: requires per-tool accumulators in server.ts.
     */
    static toolSavings(tools: Array<{
        tool: string;
        rawBytes: number;
        contextBytes: number;
    }>): ToolSavingsRow[];
    /**
     * #19 Sandbox I/O — total input/output bytes processed by the sandbox.
     *
     * Stub: requires PolyglotExecutor byte counters.
     */
    static sandboxIO(inputBytes: number, outputBytes: number): SandboxIO;
    /**
     * MCP tool usage — call counts and concurrency stats per MCP tool.
     *
     * Reads `mcp_tool_call` events, parses the JSON payload, and aggregates:
     *  - call count per tool_name
     *  - median + max of `params.concurrency` (only for tools that take it,
     *    e.g. ctx_batch_execute, ctx_fetch_and_index). Returns null when the
     *    tool doesn't carry a concurrency param so callers can render N/A.
     *
     * Best-effort: malformed rows or truncated payloads are skipped silently.
     */
    getMcpToolUsage(): McpToolUsageRow[];
    /**
     * Build a FullReport by merging runtime stats (passed in)
     * with continuity data from the DB.
     *
     * This is the ONE call that ctx_stats should use.
     */
    queryAll(runtimeStats: RuntimeStats): FullReport;
}
/**
 * Where one adapter stores its context-mode sidecars on disk. Mirrors the
 * map in `src/adapters/detect.ts:92-111` (`getSessionDirSegments`) so we
 * never go out of sync as a single source of truth.
 *
 * `sessionsDir` = `<home>/<segments>/context-mode/sessions`
 * `contentDir`  = `<home>/<segments>/context-mode/content`
 *
 * Why duplicated here: `getSessionDirSegments` returns segments relative to
 * `homedir()`; analytics needs the absolute joined paths for both `sessions`
 * and `content` siblings. Keeping a parallel hard-coded list avoids importing
 * detect.ts (which pulls in adapter loaders) into the stats path.
 */
export interface AdapterDirEntry {
    /** Adapter id matching `src/adapters/detect.ts` PlatformId. */
    name: string;
    /** Absolute path to `<home>/<segments>/context-mode/sessions`. */
    sessionsDir: string;
    /** Absolute path to `<home>/<segments>/context-mode/content`. */
    contentDir: string;
}
/**
 * Enumerate every known adapter's sessions + content dirs under `home`.
 * Used by `getMultiAdapterLifetimeStats` and `getMultiAdapterRealBytesStats`
 * so a single call surfaces "your work everywhere on this machine across
 * all AI tools" (the marketing line).
 *
 * Returns ALL 15 adapters even when the dir doesn't exist on disk — the
 * scanner functions filter to existing dirs. That keeps the enumeration
 * pure / testable without filesystem dependencies.
 */
export declare function enumerateAdapterDirs(opts?: {
    home?: string;
}): AdapterDirEntry[];
/** Aggregated stats spanning every SessionDB + auto-memory under the user's profile. */
export interface LifetimeStats {
    totalEvents: number;
    totalSessions: number;
    autoMemoryCount: number;
    autoMemoryProjects: number;
    /** Per-prefix breakdown of auto-memory files (user/feedback/project/...). */
    autoMemoryByPrefix: Record<string, number>;
    /**
     * Per-category event counts aggregated across every SessionDB on disk.
     * Keys are the raw category strings (file/cwd/rule/...) — the renderer
     * looks them up against `categoryLabels` for display. Empty `{}` when no
     * sidecar has any events. Optional for back-compat with older fixtures.
     */
    categoryCounts: Record<string, number>;
    /**
     * Total bytes restored from compact-rescue snapshots across every DB on
     * disk. Adds the rescue benefit to lifetime $ so the headline isn't
     * silently undercounting the killer feature. 0 when no compact has fired
     * or older fixtures don't pass this. Optional for back-compat with tests.
     */
    rescueBytes?: number;
    /**
     * Earliest event timestamp (ms epoch) across every DB. Used for the
     * "since 2026-04-14" lifetime narrative. 0 when unknown. Optional.
     */
    firstEventMs?: number;
    /**
     * Distinct project_dir count across every DB. Different from
     * `autoMemoryProjects` (which only counts dirs with auto-memory files).
     * Captures every cwd context-mode has ever seen events for. Optional.
     */
    distinctProjects?: number;
}
/**
 * Aggregate lifetime stats from all SessionDB files in `sessionsDir` and
 * all auto-memory markdown files under `memoryRoot/<project>/memory/`.
 *
 * Best-effort: silently ignores missing/unreadable files so ctx_stats
 * can never be broken by a corrupt sidecar.
 */
export declare function getLifetimeStats(opts?: {
    sessionsDir?: string;
    memoryRoot?: string;
    /** Override for tests — defaults to db-base loadDatabase(). */
    loadDatabase?: () => unknown;
}): LifetimeStats;
/**
 * Aggregate every event for one `session_id` across all SessionDB files in
 * `sessionsDir` plus the compact-rescue snapshot bytes from `session_resume`.
 *
 * Why this exists: the Claude Code session_id can persist across days while
 * the underlying DB file rotates (size cap), and a compact-rescue snapshot
 * carries hundreds of KB of context that would otherwise have been lost. The
 * old in-memory `tool_call_counter` saw none of this — it counted only `ctx_*`
 * MCP calls against the current MCP server PID and reset on every restart.
 * Reading from `session_events` + `session_resume` is the source-of-truth
 * version that matches what users actually experienced.
 */
export declare function getConversationStats(opts: {
    sessionId: string;
    sessionsDir?: string;
    /** Optional worktree filename prefix (sha256(cwd)[:16]). When omitted, scans every DB. */
    worktreeHash?: string;
    loadDatabase?: () => unknown;
}): ConversationStats;
/**
 * Real-bytes counter the renderer uses to replace the conservative
 * `events × 256` token estimate. Reads four sources from disk and
 * returns the sum the renderer divides by 4 to get tokens.
 *
 * - `eventDataBytes`  = SUM(LENGTH(data))      FROM session_events
 * - `bytesAvoided`    = SUM(bytes_avoided)     FROM session_events
 * - `bytesReturned`   = SUM(bytes_returned)    FROM session_events
 * - `snapshotBytes`   = SUM(LENGTH(snapshot))  FROM session_resume
 * - `totalSavedTokens` = (eventDataBytes + bytesAvoided + snapshotBytes) / 4
 *
 * `bytesReturned` is reported but NOT folded into `totalSavedTokens`
 * because it represents bytes the model already paid for — adding it
 * would double-count what's already on the user's invoice.
 */
export interface RealBytesStats {
    eventDataBytes: number;
    bytesAvoided: number;
    bytesReturned: number;
    snapshotBytes: number;
    /**
     * v1.0.133 Slice 3: bytes attributed to this session in the FTS5 content
     * DB — `SUM(LENGTH(title) + LENGTH(content)) FROM chunks WHERE session_id = ?`.
     *
     * Read-only, render-time computation. Populated only when
     * `getRealBytesStats` is called with both `sessionId` AND `contentDbPath`
     * (i.e. the conversation tier from ctx_stats). Lifetime / project tiers
     * leave this at 0 — aggregating across every adapter's content DB is a
     * separate concern.
     *
     * Legacy chunks with empty `session_id` (pre-Slice-1) are NOT backfilled:
     * the architect rejected the time-window join as unsafe. Old conversations
     * stay low; new conversations populate honestly.
     */
    contentBytes: number;
    totalSavedTokens: number;
}
/**
 * v1.0.133 Slice 3: Sum the bytes attributed to one session in the FTS5
 * content DB.
 *
 * Returns `LENGTH(title) + LENGTH(content)` summed across every chunk
 * whose `session_id` column matches `sessionId`. Best-effort — returns 0
 * when the DB file is missing, the schema lacks the `session_id` column
 * (pre-Slice-1 content DBs), or the query fails. Never throws.
 *
 * Render-time only. Does NOT mutate the content DB. Architect-approved
 * because the read-only join carries no risk of cross-session attribution
 * (the FK was set at chunk insert time by Slice 1).
 */
export declare function getContentBytesForSession(sessionId: string, contentDbPath: string, opts?: {
    loadDatabase?: () => unknown;
}): number;
/**
 * v1.0.134 SLICE C — lifetime tier all-chunks aggregate.
 *
 * Sibling of {@link getContentBytesForSession} that omits the session_id
 * filter so the lifetime tier sees every chunk in the content store —
 * including legacy unattributed rows (sessionId === '') and chunks
 * attributed to other adapters' sessions. Without this, the lifetime
 * "kept out" headline only counts session_events.bytes_avoided and
 * misses the bulk of indexed payload.
 *
 * Best-effort: returns 0 when the DB file is missing, the schema lacks
 * the `chunks` table, or the query fails. Never throws — same contract
 * as the rest of the analytics module so a corrupt content DB cannot
 * crash ctx_stats.
 */
export declare function getContentBytesAllSessions(contentDbPath: string, opts?: {
    loadDatabase?: () => unknown;
}): number;
/**
 * Compute real-bytes stats across one session, one project (worktree
 * filter), or every session on disk (lifetime).
 *
 * - Pass `sessionId` for the conversation tier.
 * - Pass `worktreeHash` to filter `*.db` files by name prefix
 *   (per-project lifetime — `sha256(cwd).slice(0, 16)`).
 * - Pass neither — full lifetime aggregate.
 *
 * Best-effort: returns zeroes when the dir is missing, the DB is
 * corrupt, or the session has no events. Never throws — same
 * contract as `getConversationStats` / `getLifetimeStats` so the
 * stats-render path can never crash on a bad sidecar.
 */
export declare function getRealBytesStats(opts: {
    sessionId?: string;
    sessionsDir?: string;
    worktreeHash?: string;
    /**
     * v1.0.148 follow-up (Bug E+F): when set, the function aggregates across
     * EVERY session whose `session_meta.project_dir` matches this value, not
     * just one session_id. Resolves the per-conversation under-attribution:
     * one Claude Code conversation typically spans many session_ids (resume
     * cycles, /compact rebirths, PID sub-process sessions spawned by
     * ctx_execute), so a single-session_id filter loses the sandbox-burst
     * bytes_avoided that all live under the conversation's cwd.
     *
     * Uses a META subquery (`session_id IN (SELECT session_id FROM
     * session_meta WHERE project_dir = ?)`), then sums ALL events for
     * matching sessions regardless of their event-level project_dir
     * (sandbox-burst events write `project_dir = ''` even when the
     * META row carries the parent cwd — see Bug F).
     *
     * Mutually exclusive with `sessionId`. When both are set, `sessionId`
     * wins for back-compat.
     */
    projectDir?: string;
    /**
     * v1.0.133 Slice 3: when set alongside `sessionId`, the function joins
     * the FTS5 content DB at this path and folds chunk bytes into
     * `bytesAvoided` + `totalSavedTokens` + `contentBytes`. Render-time
     * only — no DB writes.
     */
    contentDbPath?: string;
    loadDatabase?: () => unknown;
}): RealBytesStats;
/**
 * Real-usage filter thresholds. Decided in the B3a /diagnose conversation
 * to suppress fixture-noise dirs (test runs that touched ~/.X but never
 * carried real user work).
 *
 * An adapter is `isReal=true` iff ALL four hold:
 *   eventCount     >= 100
 *   distinctProjects >= 5
 *   lastActivity within 30 days
 *   avgEventBytes  >= 50
 *
 * Tuneable via `getMultiAdapterLifetimeStats({ filter })` for testing.
 */
export interface RealUsageFilter {
    minEvents?: number;
    minProjects?: number;
    recencyMs?: number;
    minAvgBytes?: number;
    /** Fixed "now" timestamp for deterministic testing. Defaults to Date.now(). */
    nowMs?: number;
}
/** Per-adapter scan result returned by {@link scanOneAdapter}. */
export interface AdapterScanResult {
    /** Adapter id (matches `enumerateAdapterDirs().name`). */
    name: string;
    /** Total event rows across every `*.db` in this adapter's sessions dir. */
    eventCount: number;
    /** Total distinct session_meta rows across every db. */
    sessionCount: number;
    /** Sum of LENGTH(data) across every session_event row. */
    dataBytes: number;
    /** Sum of LENGTH(snapshot) across consumed compact-rescue snapshots. */
    rescueBytes: number;
    /** Reserved for future content/ scan (B3b). 0 today. */
    contentBytes: number;
    /** Distinct session_id count across all dbs (alias of sessionCount). */
    uuidConvs: number;
    /** Distinct project_dir values across all session_events. */
    projectDirs: string[];
    /** Earliest event ms epoch (Number.POSITIVE_INFINITY when no events). */
    firstMs: number;
    /** Latest event ms epoch (0 when no events). */
    lastMs: number;
    /** Real-usage flag — see {@link RealUsageFilter}. */
    isReal: boolean;
}
/** Aggregated multi-adapter lifetime stats. */
export interface MultiAdapterLifetimeStats {
    /** Sum of eventCount across every adapter that exists on disk. */
    totalEvents: number;
    /** Sum of sessionCount across every adapter. */
    totalSessions: number;
    /** Sum of dataBytes + rescueBytes across every adapter. */
    totalBytes: number;
    /** Per-adapter rows for adapters that have >= one .db file. */
    perAdapter: AdapterScanResult[];
}
/**
 * Aggregate lifetime stats across every adapter dir under `home`.
 * The marketing line — "your work everywhere on this machine across all
 * AI tools" — depends on this. Existing `getLifetimeStats` (single dir)
 * is untouched; this is purely additive.
 */
export declare function getMultiAdapterLifetimeStats(opts?: {
    home?: string;
    loadDatabase?: () => unknown;
    filter?: RealUsageFilter;
}): MultiAdapterLifetimeStats;
/** Aggregated multi-adapter real-bytes stats. */
export interface MultiAdapterRealBytesStats extends RealBytesStats {
    /** Per-adapter row in the same shape as {@link RealBytesStats}, keyed by name. */
    perAdapter: Array<RealBytesStats & {
        name: string;
    }>;
}
/**
 * Aggregate real-bytes stats across every adapter dir under `home`.
 * Mirrors `getRealBytesStats` (single dir, analytics.ts:887-989) but
 * iterates {@link enumerateAdapterDirs}. Optional `sessionId` /
 * `worktreeHash` filters apply uniformly to every dir.
 */
export declare function getMultiAdapterRealBytesStats(opts?: {
    home?: string;
    sessionId?: string;
    worktreeHash?: string;
    loadDatabase?: () => unknown;
}): MultiAdapterRealBytesStats;
/**
 * Marketing-grade labels for auto-memory file prefixes. The renderer sees raw
 * filename prefixes (`project_codex_hooks.md` → `project`) — without this map
 * the user gets schema words in the UI, which leaks the database into UX.
 */
export declare const autoMemoryLabels: Record<string, string>;
/**
 * Marketing-grade labels for adapter ids surfaced by
 * {@link enumerateAdapterDirs} / {@link getMultiAdapterLifetimeStats}.
 * The renderer never shows raw IDs — UX uses the names users see in
 * each tool's own surface area.
 */
export declare const adapterLabels: Record<string, string>;
/**
 * Format a byte count for the narrative dashboard.
 *
 * Single-unit auto-scale (Grafana / CloudWatch / Datadog convention).
 * Decimals shrink as the integer part grows so the number stays readable
 * at every magnitude. Max output width is 8 characters which fits the
 * existing `padStart(8)` callsites in Sections 1, 3, 4.
 *
 *   < 1 KB              → "X B"        e.g. "100 B"
 *   1 KB   – < 100 KB   → "X.Y KB"     e.g. "4.7 KB",   "92.8 KB"
 *   100 KB – < 1 MB     → "X KB"       e.g. "227 KB",   "976 KB"
 *   1 MB   – < 100 MB   → "X.Y MB"     e.g. "4.5 MB",   "11.6 MB"
 *   100 MB – < 1 GB     → "X MB"       e.g. "178 MB",   "906 MB"
 *   1 GB   – < 100 GB   → "X.YY GB"    e.g. "1.00 GB",  "11.36 GB"
 *   ≥ 100 GB            → "X.Y GB"     e.g. "216.6 GB"
 *
 * Replaced the dual-unit "X KB (0.YY MB)" form because the parenthetical
 * rounded to 0.00 / 0.01 in the common range and added noise without
 * information. Scale awareness comes from the unit jump between rows.
 */
export declare function kb(b: number): string;
export declare function detectLocaleAndTz(): {
    locale: string;
    tz: string;
};
/**
 * Render the section-4 "For example: what would that cost?" block.
 *
 * Translates a lifetime token total into a relatable Opus-4 dollar figure
 * + 3 tangible comparisons (Cursor Pro / Claude Max / weekends of API
 * coding) + 10-dev team scale projection + alternate-model scale row,
 * capped with an EXAMPLES disclaimer. The renderer is intentionally
 * liberal with rounding (whole-month Cursor counts, integer weekends)
 * because this section is illustrative — the EXAMPLES line tells users
 * not to confuse it for a bill.
 *
 * Returns [] when there's nothing to scale (lifetimeTokens === 0) so
 * the section disappears cleanly on a fresh install.
 *
 * Math constants:
 *   Opus 4.7/4.8 = $5.00 per 1M input tokens (fallback when PI_CONTEXT_MODE_PRICE_OUTPUT_PER_TOKEN not set)
 *   Sonnet 4.6   = $3.00 per 1M input tokens
 *   GPT-4o       = $2.50 per 1M input tokens
 *   Gemini 2     = $1.25 per 1M input tokens
 *   Haiku 4.5    = $1.00 per 1M input tokens
 *   Cursor Pro       = $20  / month  → "X months of Cursor Pro"
 *   Claude Max       = $200 / month  → "X.X months of Claude Max"
 *   Weekend coding   ≈ $73.67        → "X weekends of nonstop API coding"
 *   Team multiplier  = 10×           → "At a 10-dev team scale: ~$X over Y days, or ~$Z/year"
 */
export declare function renderCostExample(lifetimeBytes: number, lifetimeTokens: number, lifetimeDays: number): string[];
/**
 * One day on the horizontal narrative timeline. `ms` is midnight-UTC of
 * the day (caller is responsible for normalising); `count` is captures
 * for that day; `rescueBytes` (when >0) overlays the ◆ /compact glyph.
 */
export interface TimelineDay {
    ms: number;
    count: number;
    rescueBytes?: number;
}
/**
 * Render the proportional-spacing horizontal day strip used in section 1
 * of the 5-section narrative. Returns the lines verbatim ready to splice
 * into the formatReport line buffer:
 *
 *     apr 28 ●──────────────────────●────█──────────────────────◆────● may 10
 *
 *       apr 28   277 captures
 *       may 4    438 captures  ← peak
 *       may 9    261 captures  ◆ /compact rescued 1552 KB
 *       may 10   100 captures
 *
 *     ●  active day      █  peak day      ◆  /compact rescue
 *
 * The strip body is exactly 56 chars wide. Day positions are computed as
 * `round((day - first) / (last - first) * 55)`. Glyph priority for a
 * column: rescue (◆) > peak (█) > active (●). Filler is the box-drawing
 * `─` character so the strip reads cleanly in monospace terminals.
 */
export declare function renderHorizontalTimeline(days: TimelineDay[], locale: string, tz: string): string[];
/**
 * Render a UTC ms timestamp as a human-readable local datetime string in
 * the canonical Mert-approved format:
 *
 *   "28 Apr 2026 at 12:16 (Europe/Istanbul)"
 *
 * Used by the 5-section narrative renderer (formatReport) so users see
 * exactly when their conversation started + when /compact rescues fired
 * in their wall-clock timezone — never UTC, never ambiguous.
 *
 * - 24-hour clock with zero-padded minutes ("20:54", not "8:54 PM").
 * - Day is NOT zero-padded ("9 May", not "09 May") to match the target.
 * - IANA timezone is appended verbatim in parentheses regardless of
 *   locale so users never misread Istanbul-time as UTC.
 * - Returns "" for ms === 0 or NaN so callers can guard the rendered
 *   line ("started …") without an extra timestamp-validity check.
 */
export declare function formatLocalDateTime(ms: number, locale: string, tz: string): string;
/**
 * Per-token USD rate — resolves on every call.
 * Dynamic when PI_CONTEXT_MODE_PRICE_OUTPUT_PER_TOKEN is set, Opus 4.7/4.8 input
 * ($5 per 1M tokens) otherwise.
 */
export declare function pricePerToken(): number;
/**
 * Back-compat alias for the original Opus-rate const (PR #401 architect
 * P1.1 — single source of truth). Kept as a literal so any third-party
 * consumer importing the named constant still resolves to the same
 * fallback rate. New code should call pricePerToken() to pick up the
 * dynamic Pi env override.
 *
 * @deprecated Use pricePerToken() to honor PI_CONTEXT_MODE_PRICE_OUTPUT_PER_TOKEN.
 */
export declare const OPUS_INPUT_PRICE_PER_TOKEN: number;
/** Convert a token count to a USD string at the current per-token rate. */
export declare function tokensToUsd(tokens: number): string;
/**
 * Render a FullReport as a visual savings dashboard designed for screenshotting.
 *
 * Design principles:
 * - Before/After comparison bar is the HERO — one glance = "wow"
 * - "tokens saved" is the number people share
 * - Per-tool breakdown shows what each tool SAVED, sorted by impact
 * - Project memory: category bars showing persistent data across sessions
 * - No: Pct column, category tables, tips, jargon
 */
export declare function formatReport(report: FullReport, version?: string, latestVersion?: string | null, opts?: {
    lifetime?: LifetimeStats;
    mcpUsage?: McpToolUsageRow[];
    conversation?: ConversationStats;
    /**
     * Phase 8 of D2 PRD — pass realBytes pre-aggregated from
     * `getRealBytesStats(...)` and the renderer will use those numbers
     * for the $ math instead of the conservative `events × 256` estimate.
     *
     * - `realBytes.lifetime` overrides `lifetimeTokensWithout`.
     * - `realBytes.conversation` overrides `conversationTokens`.
     * - Either may be omitted independently — missing values fall back
     *   to the legacy estimate so this feature can never produce
     *   a smaller number than before (Mert: stats only go up).
     * - When the new value is SMALLER than the legacy estimate (fresh
     *   sessions before any sandbox events emit), we keep the larger
     *   number to honour the same monotonic-growth invariant.
     */
    realBytes?: {
        lifetime?: RealBytesStats;
        conversation?: RealBytesStats;
    };
    /**
     * B3b — multi-adapter aggregation surfaced by
     * `getMultiAdapterLifetimeStats(...)` (analytics.ts:1248). When present,
     * the renderer adds a "Where it came from" sub-block under the receipt,
     * promotes the headline to "across N AI tools" when >= 2 real adapters
     * are detected, and renames the all-work block to "All your work
     * everywhere". Backward compat: omitting this opt preserves the legacy
     * single-adapter renderer output unchanged.
     */
    multiAdapter?: MultiAdapterLifetimeStats;
    /**
     * Point-in-time snapshot of the persistent content store. Optional —
     * callers that don't have store access can omit it and the renderer
     * skips the observability section gracefully.
     */
    indexState?: IndexState;
    /**
     * 5-section narrative renderer overrides. Defaults to ambient
     * `process.cwd()` + `Date.now()` + `detectLocaleAndTz()` for production
     * use; tests inject deterministic values so output is byte-stable.
     */
    cwd?: string;
    now?: number;
    locale?: string;
    tz?: string;
}): string;
