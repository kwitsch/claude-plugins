import { expect, test, type TestBody } from "claude-code/testing";
import type { TurnStepInput } from "claude-code";

type Engine = Parameters<TestBody>[0];
type On = Parameters<TestBody>[1];
type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  model: string;
};
type StepState = { seen: unknown; usage: Usage | null };

const MODEL = "claude-sonnet-5-5";

// What Claude Code passes to a ui.render hook for the /headroom pane, apart from the surface
const PANE = {
  plugin: "inline-headroom",
  component: "Pane",
  requestId: "headroom",
  viewport: { columns: 100, rows: 30 },
  props: {
    title: "Headroom",
    isFocused: true,
    bodyColumns: 60,
    placement: "inline",
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const;

// Usage whose cache-hit ratio is exactly `hit` (1000-token prompt).
const usageAt = (hit: number): Usage => ({
  input_tokens: Math.round((1 - hit) * 1000),
  output_tokens: 10,
  cache_read_input_tokens: Math.round(hit * 1000),
  cache_creation_input_tokens: 0,
  model: MODEL,
});

// Bottom turn.step hook (stands for the engine): records the effort that reached it.
function bottomStep(on: On): StepState {
  const st: StepState = { seen: "not-called", usage: null };
  on("turn.step", async function* (_$, e) {
    st.seen = e.effort;
    return {
      turnId: e.turnId,
      index: e.index,
      answer: "",
      toolUses: [],
      stopReason: "end_turn" as const,
      usage: st.usage,
    };
  });
  return st;
}

async function step($: Engine, index: number, effort: TurnStepInput["effort"], agentId?: string): Promise<void> {
  const input: TurnStepInput = {
    turnId: "t1",
    index,
    model: MODEL,
    effort,
    messageCount: 3,
    ...(agentId === undefined ? {} : { agentId }),
  };
  for await (const _chunk of $.turn.step(input)) {
    // drain the stream; the bottom hook records what reached it
  }
}

async function readOk($: Engine, on: On): Promise<void> {
  on("tool.call", () => ({ result: "file contents" }));
  await $.tool.call({ tool: "Read", file_path: "README.md" });
}

test("(a) index 1 after a successful tool call lowers high to low", async ($, on) => {
  const st = bottomStep(on);
  await readOk($, on);
  await step($, 1, "high");
  expect(st.seen).toBe("low");
});

test("(b) index 0 keeps high", async ($, on) => {
  const st = bottomStep(on);
  await step($, 0, "high");
  expect(st.seen).toBe("high");
});

test("(c) a tool error keeps high on the next step", async ($, on) => {
  const st = bottomStep(on);
  on("tool.call", () => ({ isError: true as const, result: "boom" }));
  await $.tool.call({ tool: "Read", file_path: "README.md" });
  await step($, 1, "high");
  expect(st.seen).toBe("high");
});

test("(d) a subagent step keeps high", async ($, on) => {
  const st = bottomStep(on);
  await readOk($, on);
  await step($, 1, "high", "agent-1");
  expect(st.seen).toBe("high");
});

test("(e) effort_routing_enabled false keeps high", { options: { effort_routing_enabled: false } }, async ($, on) => {
  const st = bottomStep(on);
  await readOk($, on);
  await step($, 1, "high");
  expect(st.seen).toBe("high");
});

test("(f) a numeric effort is left unchanged", async ($, on) => {
  const st = bottomStep(on);
  await readOk($, on);
  await step($, 1, 8000);
  expect(st.seen).toBe(8000);
});

test("(g) prompt.compose is read-only and the headroom pane shows shared volatile values", async ($, on) => {
  const sections = [
    { id: "identity", text: "You are Claude Code.", scope: "shared" as const },
    {
      id: "env",
      text: "Session 123e4567-e89b-12d3-a456-426614174000 started.",
      scope: "shared" as const,
    },
    {
      id: "clock",
      text: "Now 2026-10-03T12:00:00Z",
      scope: "session" as const,
    },
  ];
  on("prompt.compose", async () => ({ sections }));
  const out = await $.prompt.compose({
    model: MODEL,
    promptModel: MODEL,
    surfaces: ["terminal"],
    tools: ["Read"],
    outputStyle: null,
    traits: [],
  });
  expect(out.sections).toEqual(sections);
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: "Text", text: /env uuid/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /clock/ })).toBeUndefined();
    await ui.unmount();
  }
});

test("(h) a cache-hit drop from 90% to 10% is counted", async ($, on) => {
  const st = bottomStep(on);
  st.usage = usageAt(0.9);
  await step($, 0, "high");
  st.usage = usageAt(0.1);
  await step($, 1, "high");
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /drops 1/ })).toBeDefined();
  await ui.unmount();
});

test("(i) /headroom opens the headroom pane and prints nothing", async ($, on) => {
  const opened: unknown[] = [];
  on("ui.open", async (_$, e) => {
    opened.push(e);
    return { value: { isPlaced: true as const } };
  });
  const out = await $.command.run({ command: "headroom" });
  expect(out.text).toBeUndefined();
  expect(opened.length).toBe(1);
  expect(opened[0]).toMatchObject({ id: "headroom", title: "Headroom", focus: true, closeOnEscape: true });
});
