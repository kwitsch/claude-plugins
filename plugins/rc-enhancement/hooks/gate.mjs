// Interaction gate (turn.complete → one framed $.prompt.submit): pure heuristic and loop-guard predicate.

// The prompt the gate submits. It points at the CRITICAL RULE that hooks/SessionStart.md injects at session
// start, and the turn it starts is recognized by this text, so it never re-prompts its own retry (the loop guard).
export const GATE_REASON = "Interaction rule violation: the final response ends with a plain-text question to the user. "
  + "Follow the CRITICAL RULE from the session start (how to interact with the user): "
  + "route the question through the AskUserQuestion tool instead — no exceptions, not even a casual yes/no offer.";

/**
 * True when the last non-empty line outside fenced code blocks ends in `?`.
 * A rhetorical trailing `?` is an accepted false positive.
 * @param {string} answer  the turn's final visible text
 * @returns {boolean}
 */
export function isBareQuestion(answer) {
  const lines = answer
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return /\?\s*$/.test(lines[lines.length - 1] ?? "");
}

/**
 * True when a turn's prompt is the gate's own re-prompt (framed by the engine
 * as a plugin message, or bare): such a turn is never gated again.
 * @param {string} text  `turn.start`'s text
 * @returns {boolean}
 */
export function isGateTurn(text) {
  return text.includes(GATE_REASON);
}
