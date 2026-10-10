import { expect, mock, test, type Plugin, type TestBody } from "claude-code/testing";
import type { TurnStepInput } from "claude-code";
import { RETRIEVE_TOOL, dayKey, windowStart } from "../hooks/policy.mjs";

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
// What stats_sum answers per window start in the pane tests: distinct numbers, so each cell is findable by its text.
const windowSums = (today: string): Record<string, typeof SUMS> => ({
  [today]: { ...SUMS, steps: 5, clamped: 2 }, // hit 90%, drops 1
  [windowStart(today, 7)]: { ...SUMS, steps: 17, clamped: 9, cache_drops: 3 },
  [windowStart(today, 30)]: { ...SUMS, steps: 41, clamped: 23, cache_drops: 11, cache_read_input_tokens: 300 }, // hit 75%
});
// A main-loop turn that ended with an answer.
const DONE = { answer: "", durationMs: 1, isAborted: false, turnId: "t1", reason: "answer" as const };

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

// Stands for the storage MCP server: connect answers only for the bare key `storage`, like the engine;
// records every call; `answer`'s value is the tool's result, an Error an error result.
function stubStorage(on: On, answer: (tool: string, args: Record<string, unknown>) => unknown): StorageCall[] {
  const calls: StorageCall[] = [];
  on("mcp.connect", async (_$, e) =>
    e.server === "storage"
      ? {
          value: {
            isConnected: true as const,
            server: "plugin:inline-headroom:storage",
          },
        }
      : {
          value: {
            isConnected: false as const,
            reason: "unlisted" as const,
            message: `This plugin's manifest lists no MCP server named "${e.server}".`,
          },
        },
  );
  on("mcp.call", async (_$, e) => {
    calls.push({ tool: e.tool, args: e.args });
    const result = answer(e.tool, e.args);
    if (result instanceof Error) return { value: { content: [{ type: "text", text: result.message }], isError: true } };
    return { value: { content: [{ type: "text", text: JSON.stringify(result) }], isError: false, structuredContent: result } };
  });
  return calls;
}

// stubStorage for the pane tests: stats_sum answers `windows()` per window start (read per call, so a test can change it), every write answers ok.
function stubWindows(on: On, windows: () => Record<string, typeof SUMS>): StorageCall[] {
  return stubStorage(on, (tool, args) => (tool === "stats_sum" ? windows()[String(args.since)] : { ok: true, purged: 0 }));
}

// One pane cell by its exact text: an unanchored string is a substring match ("1" also finds 17).
const cell = (ui: Awaited<ReturnType<Engine["ui"]["mount"]>>, text: string) => ui.find({ type: "Text", text: new RegExp(`^${text}$`) });

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

// One Read call, from the main loop or (with agentId) from that subagent.
async function callRead($: Engine, agentId?: string): Promise<void> {
  await $.tool.call({ tool: "Read", file_path: "README.md", ...(agentId === undefined ? {} : { agentId }) });
}

async function readOk($: Engine, on: On, agentId?: string): Promise<void> {
  on("tool.call", () => ({ result: "file contents" }));
  await callRead($, agentId);
}

// Closes the pane the way Esc does, from a plugin: a test's own $ has no ui.close. Self-contained: the kit loads register on its own.
const closer: Plugin = {
  name: "closer",
  register(on) {
    on("command.run", { command: "closer" }, async ($) => {
      try {
        await $.ui.close({ id: "headroom" });
      } catch {
        // (u): a refused close rejects here
      }
      return {};
    });
  },
};

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

test("(d) a subagent step after its successful tool call lowers high to low", async ($, on) => {
  const st = bottomStep(on);
  await readOk($, on, "agent-1");
  await step($, 1, "high", "agent-1");
  expect(st.seen).toBe("low");
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
    expect(await ui.find({ type: "Text", text: /^ {2}clock / })).toBeUndefined(); // the session-scope section is not listed (a storage note may name clock.now)
    await ui.unmount();
  }
});

test("(h) a cache-hit drop from 90% to 10% is counted", { options: { effort_routing_enabled: false } }, async ($, on) => {
  const st = bottomStep(on);
  st.usage = usageAt(0.9);
  await step($, 0, "high");
  st.usage = usageAt(0.1);
  await step($, 1, "high");
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await cell(ui, "10%")).toBeDefined(); // the session hit: the last step's ratio, not the token-weighted 50%
  expect(await cell(ui, "1")).toBeDefined(); // drops: effort routing is off, so no clamped cell reads 1
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
  // 6 + 5 + 2 table rows, the storage note, the volatile header and four gaps.
  expect(opened[0]).toMatchObject({ id: "headroom", title: "Headroom", focus: true, closeOnEscape: true, rows: 19 });
});

test("(i2) /headroom falls back to the stats tables as text when the pane is not placed", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  const today = dayKey(NOW);
  stubWindows(on, () => windowSums(today));
  on("ui.open", async () => ({ value: { isPlaced: false as const, reason: "no surface" } }));
  const run = $.command.run({ command: "headroom" });
  await clock.settle(); // lets the one storage read finish
  const out = await run;
  expect(out.text).toMatch(/^effort routing\s+steps\s+clamped$/m);
  expect(out.text).toMatch(/^7 days\s+17\s+9$/m);
  expect(out.text).toMatch(/^cache aligner\s+hit\s+drops$/m);
  expect(out.text).toMatch(/^30 days\s+75%\s+11$/m);
  expect(out.text).toMatch(/volatile shared values: unavailable/); // no prompt.compose reached the mod
  expect(out.text).not.toMatch(/showing:/);
  expect(out.text).not.toMatch(/: on\b/);
  expect(out.text).not.toMatch(/: off\b/);
});

test("(j) an open headroom pane redraws when a step or a compose changes the stats", async ($, on) => {
  const st = bottomStep(on);
  on("prompt.compose", async () => ({
    sections: [{ id: "env", text: "Session 123e4567-e89b-12d3-a456-426614174000 started.", scope: "shared" as const }],
  }));
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await cell(ui, "1")).toBeUndefined();
  expect(await ui.find({ type: "Text", text: /volatile shared values: unavailable/ })).toBeDefined(); // until a compose reaches the mod
  await step($, 0, "high");
  expect(st.seen).toBe("high");
  expect(await cell(ui, "1")).toBeDefined(); // the session row's steps
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
  expect(await cell(ui, "1")).toBeDefined(); // the session row's steps moved before the failure
  await ui.unmount();
});

test("(l) /headroom fills the tables at once and refreshes them every 10 s while open", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  const today = dayKey(NOW);
  let w = windowSums(today);
  const calls = stubWindows(on, () => w);
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  await $.command.run({ command: "headroom" });
  await clock.settle(); // the first fetch runs unawaited after the hook returned
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await cell(ui, "5")).toBeDefined();
  expect(await cell(ui, "17")).toBeDefined();
  expect(await cell(ui, "41")).toBeDefined();
  expect(await cell(ui, "9")).toBeDefined();
  expect(await cell(ui, "23")).toBeDefined();
  expect(await cell(ui, "75%")).toBeDefined();
  expect(await cell(ui, "11")).toBeDefined();
  expect(await ui.findAll({ type: "Button" })).toHaveLength(0);
  // the three calls run in parallel: compare in window order, not arrival order
  const bySince = (a: StorageCall, b: StorageCall): number => String(a.args.since).localeCompare(String(b.args.since));
  expect([...calls].sort(bySince)).toEqual([
    { tool: "stats_sum", args: { since: windowStart(today, 30) } },
    { tool: "stats_sum", args: { since: windowStart(today, 7) } },
    { tool: "stats_sum", args: { since: today } },
  ]);
  await clock.advance(9_999);
  expect(calls).toHaveLength(3);
  w = { ...w, [windowStart(today, 7)]: { ...SUMS, steps: 18, clamped: 9, cache_drops: 3 } }; // what the service sums once a turn's row is written
  await clock.advance(1);
  expect(calls).toHaveLength(6);
  expect(await cell(ui, "18")).toBeDefined();
  await ui.unmount();
});

test("(n) storage_enabled false: the storage rows say storage is off and nothing is read or written", { options: { storage_enabled: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  const calls = stubStorage(on, () => SUMS);
  bottomStep(on);
  on("turn.complete", async () => ({ text: "" }));
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  await $.command.run({ command: "headroom" });
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /storage is off/ })).toBeDefined();
  expect(await ui.findAll({ type: "Text", text: /^–$/ })).toHaveLength(13); // 3 storage rows x 2 columns x 2 tables, plus the session hit (no tokens counted)
  await clock.advance(30_000); // no refresh timer runs with storage off
  await ui.unmount();
  await step($, 0, "high");
  await $.turn.complete(DONE);
  await clock.settle(); // a write would run unawaited here, as in (m)
  expect(calls).toEqual([]);
});

test("(o) a storage error result shows as storage unavailable", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  stubStorage(on, () => new Error("inline-headroom storage: storage is disabled (userConfig storage_enabled is not true)"));
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  await $.command.run({ command: "headroom" });
  await clock.settle();
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /storage unavailable: inline-headroom storage: storage is disabled/ })).toBeDefined();
  await ui.unmount();
});

test("(s) a clock failure shows as storage unavailable instead of loading forever", async ($, on) => {
  stubStorage(on, () => SUMS);
  on("ui.open", async () => ({ value: { isPlaced: false as const, reason: "no surface" } }));
  const out = await $.command.run({ command: "headroom" }); // no mock.clock: the kit refuses $.clock.now()
  expect(out.text).toMatch(/storage unavailable: /);
});

test("(m) a main-loop turn.complete writes today's absolute row; a failed write is rewritten with the new totals", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  let failPut = true;
  const calls = stubStorage(on, (tool) => (tool === "stats_put" && failPut ? new Error("inline-headroom storage: boom") : { ok: true, purged: 0 }));
  bottomStep(on);
  on("turn.complete", async () => ({ text: "" }));
  await step($, 0, "high");
  await step($, 1, "high", "a1"); // a subagent step: counted in the subagents row, never persisted
  await $.turn.complete({ ...DONE, agentId: "a1" }); // a subagent turn writes nothing
  await $.turn.complete(DONE);
  await clock.advance(0); // the write runs unawaited after the hook returned
  const today = dayKey(clock.now());
  const row = { day: today, steps: 1, clamped: 0, cache_drops: 0, input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  expect(calls).toHaveLength(1);
  expect(calls[0].tool).toBe("stats_put");
  expect(String(calls[0].args.writer)).toMatch(/^[a-z0-9]{8,}$/);
  expect(calls[0].args.rows).toEqual([row]);
  expect(calls[0].args.purgeBefore).toBe(windowStart(today, 30));
  failPut = false;
  await step($, 0, "high");
  await $.turn.complete(DONE);
  await clock.advance(0);
  expect(calls).toHaveLength(2);
  expect(calls[1].args.writer).toBe(calls[0].args.writer);
  expect(calls[1].args.rows).toEqual([{ ...row, steps: 2 }]);
});

test("(r) a usage with a missing token field still writes integer counters", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  const calls = stubStorage(on, () => ({ ok: true, purged: 0 }));
  const st = bottomStep(on);
  on("turn.complete", async () => ({ text: "" }));
  const { cache_read_input_tokens: _missing, ...partial } = usageAt(0.5);
  st.usage = partial as unknown as Usage; // a provider shape without one field
  await step($, 0, "high");
  await $.turn.complete(DONE);
  await clock.advance(0);
  expect(calls).toHaveLength(1);
  expect(calls[0].args.rows).toEqual([{ day: dayKey(clock.now()), steps: 1, clamped: 0, cache_drops: 0, input_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }]);
});

test("(p) turn.complete finishes its write before it resolves, and session.end starts the session row over", async ($, on) => {
  mock.clock(on, { now: NOW });
  const calls = stubStorage(on, () => ({ ok: true, purged: 0 }));
  bottomStep(on);
  on("turn.complete", async () => ({ text: "" }));
  on("session.end", async (_$, e) => ({ sessionId: e.sessionId }));
  await step($, 0, "high");
  await $.turn.complete(DONE);
  // Awaited inside the hook: core asks permission for a storage call raised after the hook returned.
  expect(calls.filter((c) => c.tool === "stats_put")).toHaveLength(1);
  await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await cell(ui, "1")).toBeUndefined(); // steps was 1 before the reset; nothing else reads 1
  await ui.unmount();
  expect(calls.filter((c) => c.tool === "stats_put")).toHaveLength(1);
});

test("(t) a second /headroom never stacks the refresh, and closing the pane stops it", { plugins: [closer] }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  const today = dayKey(NOW);
  const calls = stubWindows(on, () => windowSums(today));
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  on("ui.close", async () => ({ value: undefined })); // the bottom of the close chain: the pane closes
  await $.command.run({ command: "headroom" });
  await clock.settle();
  expect(calls).toHaveLength(3);
  await $.command.run({ command: "headroom" }); // re-open: fetches at once and restarts the timer
  await clock.settle();
  expect(calls).toHaveLength(6);
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" }); // a tick fetches through the pane's render
  await clock.advance(10_000);
  expect(calls).toHaveLength(9); // one timer ticked, not two (12)
  await $.command.run({ command: "closer" });
  await clock.advance(30_000);
  expect(calls).toHaveLength(9);
  await ui.unmount();
});

test("(v) a refresh that finds unchanged totals does not redraw the pane again", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  const today = dayKey(NOW);
  stubWindows(on, () => windowSums(today));
  let redraws = 0;
  on("ui.invalidate", async () => {
    redraws++;
    return { value: undefined };
  });
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  await $.command.run({ command: "headroom" });
  await clock.settle();
  expect(redraws).toBe(1); // the first numbers
  await clock.advance(10_000);
  expect(redraws).toBe(2); // the tick's own redraw, which fetches; the same numbers add none
});

test("(u) a refused close keeps the refresh running", { plugins: [closer] }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  const today = dayKey(NOW);
  const calls = stubWindows(on, () => windowSums(today));
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  on("ui.close", async () => ({ deny: "kept by test" })); // a hook beneath keeps the pane open
  await $.command.run({ command: "headroom" });
  await clock.settle();
  expect(calls).toHaveLength(3);
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" }); // a tick fetches through the pane's render
  await $.command.run({ command: "closer" });
  await clock.advance(10_000);
  expect(calls).toHaveLength(6);
  await ui.unmount();
});

test("(w) a pane left open with no timer (after a hot reload) re-arms its refresh on the first redraw", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  const today = dayKey(NOW);
  const calls = stubWindows(on, () => windowSums(today));
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" }); // no command.run: no timer was started
  await clock.settle();
  expect(calls).toHaveLength(3); // the first redraw fetched the rows
  await clock.advance(10_000);
  expect(calls).toHaveLength(6);
  await ui.unmount();
});

test("(x) a failed refresh keeps the last numbers under the storage note", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  const today = dayKey(NOW);
  let fail = false;
  stubStorage(on, (tool, args) => (fail ? new Error("database is locked") : tool === "stats_sum" ? windowSums(today)[String(args.since)] : { ok: true, purged: 0 }));
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  await $.command.run({ command: "headroom" });
  await clock.settle();
  fail = true;
  await clock.advance(10_000);
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /^storage unavailable: / })).toBeDefined();
  expect(await cell(ui, "17")).toBeDefined(); // the 7-day steps from the last good fetch
  await ui.unmount();
});

test("(y) the effort routing table is shown only while effort_routing_enabled is on", { options: { effort_routing_enabled: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  stubWindows(on, () => windowSums(dayKey(NOW)));
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  await $.command.run({ command: "headroom" });
  await clock.settle();
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /^effort routing$/ })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: /^cache aligner$/ })).toBeDefined();
  await ui.unmount();
});

test("(z) the cache aligner table and the volatile list are shown only while cache_aligner_enabled is on", { options: { cache_aligner_enabled: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  stubWindows(on, () => windowSums(dayKey(NOW)));
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  await $.command.run({ command: "headroom" });
  await clock.settle();
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /^cache aligner$/ })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: /^effort routing$/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^volatile shared values/ })).toBeUndefined();
  await ui.unmount();
});

test(
  "(aa) with all three levers off the pane says so, and reads nothing from storage",
  { options: { effort_routing_enabled: false, cache_aligner_enabled: false, smart_crusher_enabled: false } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW });
    const calls = stubWindows(on, () => windowSums(dayKey(NOW)));
    on("ui.open", async () => ({ value: { isPlaced: true as const } }));
    await $.command.run({ command: "headroom" });
    await clock.advance(30_000); // no refresh timer runs
    const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
    expect(await ui.find({ type: "Text", text: /^effort routing, cache aligner and smart crusher are off/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^effort routing$/ })).toBeUndefined();
    expect(calls).toHaveLength(0);
    await ui.unmount();
  },
);

test(
  "(ab) subagent_effort_routing_enabled false keeps subagent steps at high and hides the subagents row",
  { options: { subagent_effort_routing_enabled: false, storage_enabled: false } },
  async ($, on) => {
    const st = bottomStep(on);
    on("ui.open", async () => ({ value: { isPlaced: false as const, reason: "no surface" } }));
    await readOk($, on);
    await step($, 1, "high", "agent-1");
    expect(st.seen).toBe("high");
    await step($, 1, "high");
    expect(st.seen).toBe("low"); // the main loop is still clamped
    const out = await $.command.run({ command: "headroom" });
    expect(out.text).toMatch(/^effort routing\s+steps\s+clamped$/m);
    expect(out.text).not.toMatch(/^subagents/m);
  },
);

test("(ac) effort_routing_enabled false keeps subagent steps at high too", { options: { effort_routing_enabled: false } }, async ($, on) => {
  const st = bottomStep(on);
  await readOk($, on, "agent-1");
  await step($, 1, "high", "agent-1");
  expect(st.seen).toBe("high");
});

test("(ad) a subagent's index 0 keeps high", async ($, on) => {
  const st = bottomStep(on);
  await step($, 0, "high", "agent-1");
  expect(st.seen).toBe("high");
});

test("(ae) a subagent's tool error keeps only that agent at high until its next step", async ($, on) => {
  const st = bottomStep(on);
  on("tool.call", (_$, e) => (e.agentId === "a1" ? { isError: true as const, result: "boom" } : { result: "ok" }));
  await callRead($, "a1");
  await callRead($, "a2");
  await callRead($);
  await step($, 1, "high", "a1");
  expect(st.seen).toBe("high");
  await step($, 1, "high", "a2");
  expect(st.seen).toBe("low");
  await step($, 1, "high");
  expect(st.seen).toBe("low");
  await step($, 2, "high", "a1");
  expect(st.seen).toBe("low"); // the error was consumed by a1's previous step
});

test("(af) a main-loop tool error does not keep a subagent at high", async ($, on) => {
  const st = bottomStep(on);
  on("tool.call", (_$, e) => (e.agentId ? { result: "ok" } : { isError: true as const, result: "boom" }));
  await callRead($);
  await step($, 1, "high", "a1");
  expect(st.seen).toBe("low");
  await step($, 1, "high");
  expect(st.seen).toBe("high");
});

for (const storage_enabled of [true, false]) {
  test(`(ag) a finished agent's turn.complete drops its error (storage ${storage_enabled ? "on" : "off"})`, { options: { storage_enabled } }, async ($, on) => {
    const st = bottomStep(on);
    on("turn.complete", async () => ({ text: "" }));
    on("tool.call", (_$, e) => (e.agentId === "a1" ? { isError: true as const, result: "boom" } : { result: "ok" }));
    await callRead($, "a1");
    await $.turn.complete({ ...DONE, agentId: "a1" }); // the storage hook returns before any clock read for an agent turn
    await step($, 1, "high", "a1");
    expect(st.seen).toBe("low");
  });
}

test("(ah) the subagents row counts this session's subagent steps and clamps, and session.end starts it over", { options: { storage_enabled: false } }, async ($, on) => {
  bottomStep(on);
  on("tool.call", () => ({ result: "ok" }));
  on("ui.open", async () => ({ value: { isPlaced: false as const, reason: "no surface" } }));
  on("session.end", async (_$, e) => ({ sessionId: e.sessionId }));
  await step($, 0, "high", "a1");
  await step($, 1, "high", "a1");
  const before = await $.command.run({ command: "headroom" });
  expect(before.text).toMatch(/^subagents\s+2\s+1$/m);
  expect(before.text).toMatch(/^session\s+0\s+0$/m); // subagent steps never count in the main-loop session row
  await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
  const after = await $.command.run({ command: "headroom" });
  expect(after.text).toMatch(/^subagents\s+0\s+0$/m);
});

// A large JSON document on Bash stdout: 200 rows that differ only by id, one with an error status.
const BIG = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, status: i === 150 ? "error" : "ok", note: "same text" })));
const OK_BASH = { result: { stdout: BIG, stderr: "", interrupted: false } };
const SENTINEL = /^<<ccr:([0-9a-f]{12}) (\d+)_rows_offloaded>>$/;
// The smart crusher table in /headroom's text fallback: its session row's dropped and saved cells.
const CRUSHER_ROW = /^smart crusher\s+dropped\s+saved\nsession\s+(\d+)\s+(\d+)$/m;

// Raises session.start, which registers headroom_retrieve, with the ops it needs stubbed: tool.register answers
// `registeredAs` and records each spec. Call it after the test's other stubs: the kit refuses on() once $ was called.
async function startCrusher(on: On, $: Engine, registeredAs: string = RETRIEVE_TOOL): Promise<unknown[]> {
  const registered: unknown[] = [];
  on("command.register", async (_$, e) => ({ value: { command: e.name } }));
  on("tool.register", async (_$, e) => {
    registered.push(e);
    return { value: { tool: registeredAs } };
  });
  on("session.messages", async () => ({ value: [{ role: "user" as const, text: "", toolUses: [] }] }));
  on("session.start", async (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: "/tmp", surface: "terminal", isInteractive: true });
  return registered;
}

// One Bash call, from the main loop or (with agentId) from that subagent; the test's bottom tool.call stub answers it.
async function callBash($: Engine, agentId?: string) {
  return $.tool.call({ tool: "Bash", command: "cat rows.json", ...(agentId === undefined ? {} : { agentId }) });
}

// A Bash call's stdout, whatever variant the call resolved to.
const stdoutOf = (out: { result?: unknown }): unknown => (out.result as { stdout?: unknown } | undefined)?.stdout;

// The rows a crushed stdout holds, and its sentinel's hash and dropped-row count.
function crushedRows(stdout: unknown): { rows: Record<string, unknown>[]; hash: string; dropped: number } {
  const rows = JSON.parse(String(stdout)) as Record<string, unknown>[];
  const [, hash = "", dropped = "0"] = SENTINEL.exec(String(rows.at(-1)?._ccr_dropped)) ?? [];
  return { rows, hash, dropped: Number(dropped) };
}

test("(sc1) a main-loop Bash JSON result is crushed, and /headroom counts the session's savings", { options: { storage_enabled: false } }, async ($, on) => {
  on("ui.open", async () => ({ value: { isPlaced: false as const, reason: "no surface" } }));
  on("tool.call", () => ({ ...OK_BASH, text: "raw" }));
  const registered = await startCrusher(on, $);
  const out = await callBash($);
  const result = out.result as { stdout: string; stderr: string; interrupted: boolean };
  const { rows, dropped } = crushedRows(result.stdout);
  expect(registered).toHaveLength(1);
  expect(rows.length).toBeLessThan(200);
  expect(rows.some((row) => row.status === "error")).toBe(true);
  expect(dropped).toBe(200 - (rows.length - 1));
  expect(result.stderr).toBe("");
  expect(result.interrupted).toBe(false);
  expect(out.text).toBeUndefined(); // a hook's own result: core re-maps it
  const [, n, saved] = CRUSHER_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(n)).toBe(dropped);
  expect(Number(saved)).toBeGreaterThan(0);
});

test("(sc2) headroom_retrieve returns the original rows, and an unknown hash is a denied call", async ($, on) => {
  const st = bottomStep(on);
  on("tool.call", () => OK_BASH);
  await startCrusher(on, $);
  const { hash } = crushedRows(stdoutOf(await callBash($)));
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash })).result).toBe(BIG);
  const miss = await $.tool.call({ tool: RETRIEVE_TOOL, hash: "000000000000" });
  expect(typeof miss.deny).toBe("string");
  await step($, 1, "high");
  expect(st.seen).toBe("high"); // the effort observer counted the deny as a failed call
});

test("(sc3) error and deny results come back untouched", async ($, on) => {
  const st = bottomStep(on);
  let answer: { isError: true; result: unknown } | { deny: string } = { isError: true, result: OK_BASH.result };
  on("tool.call", () => answer);
  await startCrusher(on, $);
  expect(await callBash($)).toEqual({ isError: true, result: OK_BASH.result });
  await step($, 1, "high");
  expect(st.seen).toBe("high");
  answer = { deny: "no" };
  expect(await callBash($)).toEqual({ deny: "no" });
});

test("(sc4) smart_crusher_enabled false registers no tool, crushes nothing and hides the table", { options: { smart_crusher_enabled: false, storage_enabled: false } }, async ($, on) => {
  const st = bottomStep(on);
  on("ui.open", async () => ({ value: { isPlaced: false as const, reason: "no surface" } }));
  on("tool.call", () => OK_BASH);
  const registered = await startCrusher(on, $);
  expect(stdoutOf(await callBash($))).toBe(BIG);
  expect(registered).toHaveLength(0);
  await step($, 1, "high");
  expect(st.seen).toBe("low"); // effort routing still clamps after the successful call
  expect((await $.command.run({ command: "headroom" })).text).not.toMatch(/^smart crusher/m);
});

test("(sc5) an MCP result gets only its JSON text block rewritten", async ($, on) => {
  const image = { type: "image", data: "x", mimeType: "image/png" };
  // Core resolves an MCP call to the content-block array itself (live-verified on 2.1.296).
  on("tool.call", () => ({ result: [{ type: "text", text: BIG }, image] }));
  await startCrusher(on, $);
  const out = await $.tool.call({ tool: "mcp__srv__list" });
  const content = out.result as { text?: string }[];
  expect(crushedRows(content[0].text).rows.length).toBeLessThan(200);
  expect(content[1]).toEqual(image);
});

test("(sc6) a subagent's Bash result is not crushed, and its effort routing is unchanged", async ($, on) => {
  const st = bottomStep(on);
  on("tool.call", () => OK_BASH);
  await startCrusher(on, $);
  expect(stdoutOf(await callBash($, "a1"))).toBe(BIG);
  await step($, 1, "high", "a1");
  expect(st.seen).toBe("low");
});

test("(sc7) no rows are dropped when headroom_retrieve registered under another name", async ($, on) => {
  on("tool.call", () => OK_BASH);
  await startCrusher(on, $, "mcp__other__headroom_retrieve");
  expect(stdoutOf(await callBash($))).toBe(BIG);
});

test("(sc8) a crushed result keeps the reminder context other hooks set", async ($, on) => {
  let answer: typeof OK_BASH & { context?: string[] } = { ...OK_BASH, context: ["reminder from another hook"] };
  on("tool.call", () => answer);
  await startCrusher(on, $);
  const withContext = await callBash($);
  expect(crushedRows(stdoutOf(withContext)).rows.length).toBeLessThan(200);
  expect(withContext.context).toEqual(["reminder from another hook"]);
  answer = OK_BASH;
  const without = await callBash($);
  expect(crushedRows(stdoutOf(without)).rows.length).toBeLessThan(200);
  expect(without.context).toBeUndefined();
});

test(
  "(sc9) with only the crusher on, its hook still runs and the pane shows its table without reading storage",
  { options: { effort_routing_enabled: false, cache_aligner_enabled: false } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW });
    const calls = stubWindows(on, () => windowSums(dayKey(NOW)));
    on("ui.open", async () => ({ value: { isPlaced: true as const } }));
    on("tool.call", () => OK_BASH);
    await startCrusher(on, $);
    expect(crushedRows(stdoutOf(await callBash($))).rows.length).toBeLessThan(200);
    await $.command.run({ command: "headroom" });
    await clock.advance(30_000); // no refresh timer runs
    const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
    expect(await ui.find({ type: "Text", text: /^smart crusher$/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^effort routing$/ })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: /are off: nothing to show/ })).toBeUndefined();
    expect(calls).toHaveLength(0);
    await ui.unmount();
  },
);

test("(sc11) a crush redraws an open /headroom pane", { options: { storage_enabled: false } }, async ($, on) => {
  let redraws = 0;
  on("ui.invalidate", async () => {
    redraws++;
    return { value: undefined };
  });
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  on("tool.call", () => OK_BASH);
  await startCrusher(on, $);
  await $.command.run({ command: "headroom" });
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  const before = redraws;
  expect(crushedRows(stdoutOf(await callBash($))).rows.length).toBeLessThan(200);
  expect(redraws).toBe(before + 1);
  await ui.unmount();
});

test(
  "(sc12) with only the crusher on, the pane asks for its own height and shows no storage note",
  { options: { effort_routing_enabled: false, cache_aligner_enabled: false, storage_enabled: false } },
  async ($, on) => {
    const opened: { rows?: number }[] = [];
    on("ui.open", async (_$, e) => {
      opened.push(e);
      return { value: { isPlaced: true as const } };
    });
    await startCrusher(on, $);
    await $.command.run({ command: "headroom" });
    expect(opened[0].rows).toBe(3); // the crusher table's 2 rows, the empty volatile block and the gap between
    const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
    expect(await ui.find({ type: "Text", text: /^smart crusher$/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /storage is off/ })).toBeUndefined();
    await ui.unmount();
  },
);

test("(sc10) session.end starts the smart crusher row over", { options: { storage_enabled: false } }, async ($, on) => {
  on("ui.open", async () => ({ value: { isPlaced: false as const, reason: "no surface" } }));
  on("session.end", async (_$, e) => ({ sessionId: e.sessionId }));
  on("tool.call", () => OK_BASH);
  await startCrusher(on, $);
  await callBash($);
  const [, before] = CRUSHER_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(before)).toBeGreaterThan(0);
  await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
  expect((await $.command.run({ command: "headroom" })).text).toMatch(/^smart crusher\s+dropped\s+saved\nsession\s+0\s+0$/m);
});
