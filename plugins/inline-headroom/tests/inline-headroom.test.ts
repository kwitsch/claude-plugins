import { expect, mock, test, type TestBody } from "claude-code/testing";
import type { TurnStepInput } from "claude-code";
import { dayKey, windowStart } from "../hooks/policy.mjs";

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
type StorageCall = { tool: string; args: Record<string, unknown> };

const MODEL = "claude-sonnet-5-5";
const NOW = Date.UTC(2026, 9, 3, 12);
// What stats_sum answers in the pane tests: cache hit 900 / 1000 = 90%.
const SUMS = { steps: 5, clamped: 2, cache_drops: 1, input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 };

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

// Stands for the storage MCP server: records every call; `answer`'s value is the tool's result, an Error an error result.
function stubStorage(on: On, answer: (tool: string, args: Record<string, unknown>) => unknown): StorageCall[] {
  const calls: StorageCall[] = [];
  on("mcp.connect", async () => ({ value: { isConnected: true as const, server: "plugin:inline-headroom:storage" } }));
  on("mcp.call", async (_$, e) => {
    calls.push({ tool: e.tool, args: e.args });
    const result = answer(e.tool, e.args);
    if (result instanceof Error) return { value: { content: [{ type: "text", text: result.message }], isError: true } };
    return { value: { content: [{ type: "text", text: JSON.stringify(result) }], isError: false, structuredContent: result } };
  });
  return calls;
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

test("(i2) /headroom falls back to the stats text when the pane is not placed", async ($, on) => {
  on("ui.open", async () => ({ value: { isPlaced: false as const, reason: "no surface" } }));
  const out = await $.command.run({ command: "headroom" });
  expect(out.text).toMatch(/showing: Session/);
  expect(out.text).toMatch(/effort routing: on/);
  expect(out.text).toMatch(/volatile shared values: none/);
});

test("(j) an open headroom pane redraws when a step or a compose changes the stats", async ($, on) => {
  const st = bottomStep(on);
  on("prompt.compose", async () => ({
    sections: [{ id: "env", text: "Session 123e4567-e89b-12d3-a456-426614174000 started.", scope: "shared" as const }],
  }));
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /main-loop steps 0/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /volatile shared values: none/ })).toBeDefined();
  await step($, 0, "high");
  expect(st.seen).toBe("high");
  expect(await ui.find({ type: "Text", text: /main-loop steps 1/ })).toBeDefined();
  await $.prompt.compose({ model: MODEL, promptModel: MODEL, surfaces: ["terminal"], tools: ["Read"], outputStyle: null, traits: [] });
  expect(await ui.find({ type: "Text", text: /env uuid/ })).toBeDefined();
  await ui.unmount();
});

test("(k) a failed step still redraws the open headroom pane", async ($, on) => {
  on("turn.step", async function* () {
    throw new Error("API error");
  });
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await expect(step($, 0, "high")).rejects.toThrow(); // the kit rethrows a failing bottom hook as a HooksError
  expect(await ui.find({ type: "Text", text: /main-loop steps 1/ })).toBeDefined();
  await ui.unmount();
});

test("(l) the pane opens on Session and a button switches to a labelled aggregate view", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  const calls = stubStorage(on, () => SUMS);
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /showing: Session/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /main-loop steps 0/ })).toBeDefined();
  expect(await ui.findAll({ type: "Button" })).toHaveLength(4);
  await ui.press({ key: "7d" }); // resolves once the async onPress settled
  const today = dayKey(clock.now());
  expect(await ui.find({ type: "Text", text: `showing: 7 days (${windowStart(today, 7)} – ${today})` })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /main-loop steps 5 · clamped 2/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /cache hit 90% · drops 1/ })).toBeDefined();
  expect(calls).toEqual([{ tool: "stats_sum", args: { since: windowStart(today, 7) } }]);
  await ui.press({ key: "session" });
  expect(await ui.find({ type: "Text", text: /showing: Session/ })).toBeDefined();
  await ui.press({ key: "day" });
  expect(await ui.find({ type: "Text", text: `showing: Today (${today})` })).toBeDefined();
  await $.command.run({ command: "headroom" }); // every /headroom opens on Session
  expect(await ui.find({ type: "Text", text: /showing: Session/ })).toBeDefined();
  await ui.unmount();
});

test("(n) storage_enabled false: the aggregate views say storage is off and nothing is written", { options: { storage_enabled: false } }, async ($, on) => {
  const calls = stubStorage(on, () => SUMS);
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "30d" });
  expect(await ui.find({ type: "Text", text: /showing: 30 days/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /storage is off/ })).toBeDefined();
  await ui.press({ key: "session" });
  expect(await ui.find({ type: "Text", text: /main-loop steps 0/ })).toBeDefined();
  await ui.unmount();
  expect(calls).toEqual([]);
});

test("(o) a storage error result shows as storage unavailable", async ($, on) => {
  mock.clock(on, { now: NOW });
  stubStorage(on, () => new Error("inline-headroom storage: storage is disabled (userConfig storage_enabled is not true)"));
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "day" });
  expect(await ui.find({ type: "Text", text: /storage unavailable: inline-headroom storage: storage is disabled/ })).toBeDefined();
  await ui.unmount();
});
