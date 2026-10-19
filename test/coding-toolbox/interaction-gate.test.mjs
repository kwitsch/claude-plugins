// Interaction gate (turn.complete → one framed $.prompt.submit) — the pure heuristic and
// loop-guard predicate in plugins/coding-toolbox/hooks/policy.mjs. Hook wiring (exactly
// one re-prompt per user turn) is covered by plugins/coding-toolbox/tests/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_REASON, isBareQuestion, isGateTurn } from "../../plugins/coding-toolbox/hooks/policy.mjs";

test("gates when the final line ends in a bare '?'", () => {
  assert.equal(isBareQuestion("Done here.\nWant me to X or Y?"), true);
  assert.equal(isBareQuestion("Shall I?   \n\n  "), true);
});

test("allows a normal final line, an empty answer, and a question inside a code fence", () => {
  assert.equal(isBareQuestion("All done. Summary above."), false);
  assert.equal(isBareQuestion(""), false);
  assert.equal(isBareQuestion("Result:\n```\nwhat?\n```"), false);
  assert.equal(isBareQuestion("Is it?\nYes, it is."), false);
});

test("the reason tells Claude to redo it via AskUserQuestion", () => {
  assert.match(GATE_REASON, /AskUserQuestion/);
});

test("a turn started by the gate's own prompt, framed or bare, is recognized", () => {
  assert.equal(isGateTurn(GATE_REASON), true);
  assert.equal(isGateTurn(`The coding-toolbox plugin sent a message: ${GATE_REASON}`), true);
  assert.equal(isGateTurn("please continue"), false);
  assert.equal(isGateTurn(""), false);
});
