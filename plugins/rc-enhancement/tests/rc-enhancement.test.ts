import { expect, mock, test, type TestBody } from "claude-code/testing";
import { GATE_REASON } from "../hooks/gate.mjs";

type On = Parameters<TestBody>[1];

// Stands for the engine's turn and prompt chains; records every prompt a plugin submitted.
function stubTurns(on: On): string[] {
  const prompts: string[] = [];
  on("turn.start", async (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", async () => ({ text: "" }));
  on("prompt.submit", async (_$, e) => {
    prompts.push(e.text);
    return { text: e.text };
  });
  return prompts;
}

const done = (turnId: string, answer: string, agentId?: string) => ({
  answer,
  durationMs: 1,
  isAborted: false,
  turnId,
  reason: "answer" as const,
  ...(agentId === undefined ? {} : { agentId }),
});

test("a main-loop answer ending in a bare question gets exactly one gate prompt; the gate's own turn is never gated", async ($, on) => {
  const clock = mock.clock(on);
  const prompts = stubTurns(on);
  await $.turn.start({ text: "do it", turnId: "t1" });
  await $.turn.complete(done("t1", "Done.\n```\nwhy?\n```\nWant me to X or Y?"));
  await clock.settle();
  expect(prompts).toEqual([GATE_REASON]);
  await $.turn.start({ text: `The rc-enhancement plugin sent a message: ${GATE_REASON}`, turnId: "t2" });
  await $.turn.complete(done("t2", "Still asking?"));
  await clock.settle();
  expect(prompts.length).toBe(1);
});

test("the loop guard holds even when the gate turn's prompt text does not carry the reason", async ($, on) => {
  const clock = mock.clock(on);
  const prompts = stubTurns(on);
  await $.turn.start({ text: "do it", turnId: "t1" });
  await $.turn.complete(done("t1", "Shall I?"));
  await clock.settle();
  await $.turn.start({ text: "", turnId: "t2" }); // the gate's turn, framed beyond recognition
  await $.turn.complete(done("t2", "Still asking?"));
  await clock.settle();
  expect(prompts.length).toBe(1);
  await $.turn.start({ text: "next request", turnId: "t3" }); // a new user turn is gated again
  await $.turn.complete(done("t3", "Which one?"));
  await clock.settle();
  expect(prompts.length).toBe(2);
});

test("no gate prompt for a plain answer, a code-fenced question, or a subagent's question", async ($, on) => {
  const clock = mock.clock(on);
  const prompts = stubTurns(on);
  await $.turn.start({ text: "do it", turnId: "t1" });
  await $.turn.complete(done("t1", "All done. Summary above."));
  await $.turn.complete(done("t1", "Here:\n```\nok?\n```"));
  await $.turn.complete(done("a-t1", "Which file?", "a1"));
  await clock.settle();
  expect(prompts).toEqual([]);
});
