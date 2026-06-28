// Extract context-mode's continuity payload from a delegated SessionStart
// additionalContext, discarding its routing block. context-mode appends continuity
// AFTER its routing block in one of two shapes:
//   - <session_knowledge source="...">…</session_knowledge>  (buildSessionDirective: compact + live-resume)
//   - "# Session Resume\n…"                                  (snapshot fallback on /resume)
// Whitelist: slice from the earliest known marker to the end. null if no marker.
const MARKERS = ["<session_knowledge", "# Session Resume"];

/**
 * @param {string|null|undefined} ctxAdditionalContext
 * @returns {string|null}
 */
export function extractContinuity(ctxAdditionalContext) {
  if (!ctxAdditionalContext || typeof ctxAdditionalContext !== "string") return null;
  let idx = -1;
  for (const m of MARKERS) {
    const i = ctxAdditionalContext.indexOf(m);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return null;
  const slice = ctxAdditionalContext.slice(idx).trim();
  return slice || null;
}
