import type { Register } from "claude-code";
import { GATE_REASON, isBareQuestion, isGateTurn } from "./gate.mjs";

// The main-loop turn the gate's own re-prompt started: never gated again, so at most one re-prompt per user turn.
// Module state: a hot reload forgets it, which at worst lets one more re-prompt through.
let gateTurnId: string | undefined;
// Backstop for the text match: the next main-loop turn after a submit counts as the gate's, so a changed framing
// can never loop. A user prompt that starts first takes the exemption instead: at worst one missed gate.
let gatePending = false;

export const register: Register = (on) => {
  // Stop has no native block for a user-tier mod, so a main-loop answer ending in a bare question gets one
  // framed plugin prompt that starts a new turn telling Claude to redo it via AskUserQuestion.
  on("turn.start", ($, e, next) => {
    if (e.agentId === undefined) {
      gateTurnId = gatePending || isGateTurn(e.text) ? e.turnId : undefined;
      gatePending = false;
    }
    return next(e);
  });
  on("turn.complete", ($, e, next) => {
    if (e.agentId === undefined && e.reason === "answer" && e.turnId !== gateTurnId && isBareQuestion(e.answer)) {
      gatePending = true;
      // Not awaited: it resolves only once the new turn starts, which waits for this turn to end.
      $.prompt.submit({ text: GATE_REASON }).catch(() => {
        gatePending = false;
      });
    }
    return next(e);
  });
};
