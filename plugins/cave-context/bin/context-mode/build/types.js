/**
 * types — Shared type definitions for context-mode packages.
 *
 * Contains interfaces that are genuinely shared between the core (ContentStore,
 * PolyglotExecutor) and the session domain (SessionDB, event extraction).
 * Import from "./types.js".
 */
// ─────────────────────────────────────────────────────────
// Priority constants
// ─────────────────────────────────────────────────────────
/**
 * Priority levels for SessionEvent records. Higher numbers are more important
 * and are retained when the snapshot budget is tight.
 */
export const EventPriority = {
    LOW: 1,
    NORMAL: 2,
    HIGH: 3,
    CRITICAL: 4,
};
