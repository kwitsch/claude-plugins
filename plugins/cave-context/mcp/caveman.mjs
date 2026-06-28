// caveman.mjs — caveman ruleset text (caveman:compress format), fixed at the
// "full" compression level.
//
// cave-context's caveman mode is always-on full: there is NO level switching
// (lite/ultra removed), NO off switch, NO userConfig, and NO runtime state. The
// level is a constant, so this module is just one text builder — reminderText()
// for the per-turn UserPromptSubmit reminder. The SessionStart ruleset + routing
// now lives statically in hooks/SessionStart.md (the sole source).

// Return the fixed per-turn caveman reminder injected on every UserPromptSubmit.
/** @returns {string} */
export function reminderText() {
  return "CAVE-CONTEXT: Drop articles/filler/hedging. Fragments OK. Code/commits/security: write normal. Big output→ctx_*.";
}
