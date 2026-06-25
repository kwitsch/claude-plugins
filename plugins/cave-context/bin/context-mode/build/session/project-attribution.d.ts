/**
 * Project attribution heuristics for session events.
 *
 * Goal: avoid pinning all activity to the startup directory when work shifts
 * across projects mid-session. This module resolves a best-effort project
 * directory per event and attaches a confidence score + source signal.
 */
import type { SessionEvent } from "../types.js";
/**
 * Confidence scores for project attribution sources.
 *
 * Higher = more reliable signal. The hierarchy reflects how directly
 * the signal indicates the user's intended project:
 * - Explicit config (workspace roots) > explicit navigation (cd) > implicit context
 * - Path-bearing events score higher than fallbacks without path signals
 */
export declare const ATTRIBUTION_CONFIDENCE: {
    /** Explicit workspace root from IDE/editor config */
    readonly WORKSPACE_ROOT: 0.98;
    /** User explicitly navigated here (cd command) */
    readonly CWD_EVENT: 0.9;
    /** Hook payload cwd — reliable but implicit */
    readonly INPUT_CWD: 0.88;
    /** Session startup directory */
    readonly SESSION_ORIGIN: 0.82;
    /** Carry-forward from previous high-confidence event */
    readonly LAST_SEEN: 0.76;
    /** Inferred from file path prefix matching */
    readonly EVENT_PATH: 0.7;
    /** Minimum confidence to carry forward as lastKnownProjectDir */
    readonly CARRY_FORWARD_THRESHOLD: 0.55;
    /** Fallback: input_cwd without path signal */
    readonly FALLBACK_INPUT_CWD: 0.45;
    /** Fallback: last_seen without path signal */
    readonly FALLBACK_LAST_SEEN: 0.4;
    /** Fallback: session_origin without path signal */
    readonly FALLBACK_SESSION_ORIGIN: 0.35;
};
export type AttributionSource = "event_path" | "cwd_event" | "input_cwd" | "workspace_root" | "last_seen" | "session_origin" | "env" | "test" | "unknown";
export interface ProjectAttribution {
    projectDir: string;
    source: AttributionSource;
    confidence: number;
}
export interface AttributionContext {
    sessionOriginDir?: string | null;
    inputProjectDir?: string | null;
    workspaceRoots?: string[] | null;
    lastKnownProjectDir?: string | null;
}
/**
 * Resolve the most likely project directory for one event.
 */
export declare function resolveProjectAttribution(event: SessionEvent, context: AttributionContext): ProjectAttribution;
/**
 * Convenience helper: resolve attributions for a stream of events while
 * carrying forward the latest confident project as context.
 */
export declare function resolveProjectAttributions(events: SessionEvent[], context: AttributionContext): ProjectAttribution[];
/**
 * 0..100 score for UI display.
 */
export declare function confidenceToPercent(confidence: number): number;
/**
 * True when attribution is strong enough for project-level spending claims.
 */
export declare function isHighConfidenceAttribution(confidence: number): boolean;
/**
 * Lightweight utility used by some hooks to normalize path separators
 * before writing attribution metadata.
 */
export declare function normalizeProjectDir(projectDir: string): string;
export declare const PROJECT_ATTRIBUTION_VERSION = 1;
