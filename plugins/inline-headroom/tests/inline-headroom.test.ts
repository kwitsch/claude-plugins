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
// The five router compressors of 0.7.0 off: tests of the earlier levers keep seeing the text those levers saw before.
// Declared up here because test options are read at module load, before the compression tests further down.
const NEW_LEVERS_OFF = {
  log_compressor_enabled: false,
  search_compressor_enabled: false,
  diff_compressor_enabled: false,
  text_crusher_enabled: false,
  relevance_split_enabled: false,
};

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
  // 6 + 5 + 2 × 11 table rows, the storage note and thirteen gaps.
  expect(opened[0]).toMatchObject({ id: "headroom", title: "Headroom", focus: true, closeOnEscape: true, rows: 47 });
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
  expect(out.text).not.toMatch(/showing:/);
  expect(out.text).not.toMatch(/: on\b/);
  expect(out.text).not.toMatch(/: off\b/);
});

test("(j) an open headroom pane redraws when a step changes the stats", async ($, on) => {
  const st = bottomStep(on);
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await cell(ui, "1")).toBeUndefined();
  await step($, 0, "high");
  expect(st.seen).toBe("high");
  expect(await cell(ui, "1")).toBeDefined(); // the session row's steps
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

test("(m) a turn.complete writes today's absolute row, subagent steps and clamps included; a failed write is rewritten with the new totals", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  let failPut = true;
  const calls = stubStorage(on, (tool) => (tool === "stats_put" && failPut ? new Error("inline-headroom storage: boom") : { ok: true, purged: 0 }));
  bottomStep(on);
  on("turn.complete", async () => ({ text: "" }));
  await step($, 0, "high");
  await step($, 1, "high", "a1"); // a clamped subagent step: counted in today's row as well as the subagents row
  await $.turn.complete({ ...DONE, agentId: "a1" }); // an agent's turn writes too
  await clock.advance(0);
  const today = dayKey(clock.now());
  const row = { day: today, steps: 2, clamped: 1, cache_drops: 0, input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
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
  expect(calls[1].args.rows).toEqual([{ ...row, steps: 3 }]);
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

test("(z) the cache aligner table is shown only while cache_aligner_enabled is on", { options: { cache_aligner_enabled: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  stubWindows(on, () => windowSums(dayKey(NOW)));
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  await $.command.run({ command: "headroom" });
  await clock.settle();
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /^cache aligner$/ })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: /^effort routing$/ })).toBeDefined();
  await ui.unmount();
});

test(
  "(aa) with every lever off the pane says so, and reads nothing from storage",
  {
    options: {
      ...NEW_LEVERS_OFF,
      effort_routing_enabled: false,
      cache_aligner_enabled: false,
      smart_crusher_enabled: false,
      lossless_compaction_enabled: false,
      cross_turn_dedup_enabled: false,
      dense_line_elider_enabled: false,
      config_compressor_enabled: false,
      html_extractor_enabled: false,
    },
  },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW });
    const calls = stubWindows(on, () => windowSums(dayKey(NOW)));
    on("ui.open", async () => ({ value: { isPlaced: true as const } }));
    await $.command.run({ command: "headroom" });
    await clock.advance(30_000); // no refresh timer runs
    const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
    expect(
      await ui.find({
        type: "Text",
        text: /^effort routing, cache aligner, smart crusher, lossless compaction, cross-turn dedup, dense line elider, config compressor, HTML extractor, log compressor, search compressor, diff compressor, text crusher and relevance split are off/,
      }),
    ).toBeDefined();
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
    await $.turn.complete({ ...DONE, agentId: "a1" }); // with storage on, the kit refuses $.clock.now() (no mock.clock) and the write is skipped
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

// A large JSON document: 200 rows that differ only by id, one with an error status.
const BIG = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, status: i === 150 ? "error" : "ok", note: "same text" })));
const SENTINEL = /^<<ccr:([0-9a-f]{12}) (\d+)_rows_offloaded>>$/;
// The compression tables in /headroom's text fallback: each session row's two cells.
const CRUSHER_ROW = /^smart crusher\s+dropped\s+saved\nsession\s+(\d+)\s+(\d+)$/m;
const DEDUP_ROW = /^dedup\s+spans\s+saved\nsession\s+(\d+)\s+(\d+)$/m;
const ELIDER_ROW = /^line elider\s+lines\s+saved\nsession\s+(\d+)\s+(\d+)$/m;
const COMPACTION_ROW = /^compaction\s+arrays\s+saved\nsession\s+(\d+)\s+(\d+)$/m;
// The lossy crusher alone: lossless compaction would render BIG as a table first.
const LOSSY = { lossless_compaction_enabled: false };
// Ten numbered lines of 40+ characters: the kind of output a re-read repeats.
const TEN = Array.from({ length: 10 }, (_, i) => `${i + 1}:const value${i} = computeSomething(${i}); // line ${i}`).join("\n");
// A dedup pointer: the run's line count, the result it names and the hash of its stored text.
const POINTER = /^\[↑(\d+)L same as result (\d+)(?: [+-]\d+L)?: ".*" hash=([0-9a-f]{12})\]$/;
// A minified bundle: one 2500-character line without a space, then a short line.
const DENSE = `${"x".repeat(2500)}\nexit 0`;
// The pane is not placed (headless): /headroom answers with the tables as text.
const notPlaced = async () => ({ value: { isPlaced: false as const, reason: "no surface" } });

// Raises session.start, which registers headroom_retrieve, with the ops it needs stubbed: tool.register answers
// `registeredAs` and records each spec. Call it after the test's other stubs: the kit refuses on() once $ was called.
// `userText` is the one user message session.messages answers with: "" (a tool result) gives an empty query.
async function startCrusher(on: On, $: Engine, registeredAs: string = RETRIEVE_TOOL, userText = ""): Promise<unknown[]> {
  const registered: unknown[] = [];
  on("command.register", async (_$, e) => ({ value: { command: e.name } }));
  on("tool.register", async (_$, e) => {
    registered.push(e);
    return { value: { tool: registeredAs } };
  });
  on("session.messages", async () => ({ value: [{ role: "user" as const, text: userText, toolUses: [] }] }));
  on("session.start", async (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: "/tmp", surface: "terminal", isInteractive: true });
  return registered;
}

// One Bash call from the main loop; the test's bottom tool.call stub answers it.
async function callBash($: Engine) {
  return $.tool.call({ tool: "Bash", command: "cat rows.json" });
}

let rowSeq = 0; // a fresh tool_use id and row uuid per raised row
// Raises one tool-result row through the test's own $.session.append, as the engine appends a tool's result (door
// tool-result, origin the tool), and resolves to the stored tool_result's content: what the model reads.
async function appendResult($: Engine, tool: string, content: unknown, opts: { agentId?: string; isError?: boolean } = {}): Promise<unknown> {
  const n = ++rowSeq;
  const r = await $.session.append({
    message: { type: "user", role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_${n}`, content, ...(opts.isError ? { is_error: true } : {}) }] },
    door: "tool-result",
    origin: { kind: "tool", tool },
    uuid: `row-${n}`,
    ...(opts.agentId === undefined ? {} : { agentId: opts.agentId }),
  });
  return r.message?.content[0]?.content;
}

// The rows a crushed document holds, and its sentinel's hash and dropped-row count.
function crushedRows(text: unknown): { rows: Record<string, unknown>[]; hash: string; dropped: number } {
  const parsed = JSON.parse(String(text)) as Record<string, unknown>[];
  const [, hash = "", dropped = "0"] = SENTINEL.exec(String(parsed.at(-1)?._ccr_dropped)) ?? [];
  return { rows: parsed, hash, dropped: Number(dropped) };
}

test("(sc1) a main-loop Bash JSON row is stored crushed, and /headroom counts the session's savings", { options: { ...LOSSY, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  const registered = await startCrusher(on, $);
  const { rows: kept, dropped } = crushedRows(await appendResult($, "Bash", BIG));
  expect(registered).toHaveLength(1);
  expect(kept.length).toBeLessThan(200);
  expect(kept.some((row) => row.status === "error")).toBe(true);
  expect(dropped).toBe(200 - (kept.length - 1));
  const [, n, saved] = CRUSHER_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(n)).toBe(dropped);
  expect(Number(saved)).toBeGreaterThan(0);
});

test("(sc2) headroom_retrieve returns the original rows, and an unknown hash is a denied call", { options: LOSSY }, async ($, on) => {
  const st = bottomStep(on);
  await startCrusher(on, $);
  const { hash } = crushedRows(await appendResult($, "Bash", BIG));
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash })).result).toBe(BIG);
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash: `hash=${hash}` })).result).toBe(BIG); // a marker's own `hash=H` text works too
  const miss = await $.tool.call({ tool: RETRIEVE_TOOL, hash: "000000000000" });
  expect(typeof miss.deny).toBe("string");
  await step($, 1, "high");
  expect(st.seen).toBe("high"); // the effort observer counted the deny as a failed call
});

test("(sc3) an error row is stored untouched, and tool.call error and deny results come back untouched", async ($, on) => {
  const st = bottomStep(on);
  let answer: { isError: true; result: unknown } | { deny: string } = { isError: true, result: "boom" };
  on("tool.call", () => answer);
  await startCrusher(on, $);
  expect(await appendResult($, "Bash", BIG, { isError: true })).toBe(BIG);
  expect(await callBash($)).toEqual({ isError: true, result: "boom" });
  await step($, 1, "high");
  expect(st.seen).toBe("high");
  answer = { deny: "no" };
  expect(await callBash($)).toEqual({ deny: "no" });
});

test(
  "(sc4) with every compression lever off no tool is registered, rows are stored untouched and no compression table shows",
  {
    options: {
      ...NEW_LEVERS_OFF,
      smart_crusher_enabled: false,
      lossless_compaction_enabled: false,
      cross_turn_dedup_enabled: false,
      dense_line_elider_enabled: false,
      config_compressor_enabled: false,
      html_extractor_enabled: false,
      storage_enabled: false,
    },
  },
  async ($, on) => {
    const st = bottomStep(on);
    on("ui.open", notPlaced);
    on("tool.call", () => ({ result: "ok" }));
    const registered = await startCrusher(on, $);
    expect(await appendResult($, "Bash", BIG)).toBe(BIG);
    expect(await appendResult($, "Bash", DENSE)).toBe(DENSE);
    expect(registered).toHaveLength(0);
    await callRead($);
    await step($, 1, "high");
    expect(st.seen).toBe("low"); // effort routing still clamps after the successful call
    const text = (await $.command.run({ command: "headroom" })).text ?? "";
    expect(text).not.toMatch(/^smart crusher/m);
    expect(text).not.toMatch(/^dedup/m);
    expect(text).not.toMatch(/^line elider/m);
    expect(text).not.toMatch(/^compaction/m);
    expect(text).not.toMatch(/^config/m);
    expect(text).not.toMatch(/^html extractor/m);
    expect(text).not.toMatch(/^logs/m);
    expect(text).not.toMatch(/^search/m);
    expect(text).not.toMatch(/^diff/m);
    expect(text).not.toMatch(/^text crusher/m);
    expect(text).not.toMatch(/^relevance split/m);
  },
);

test(
  "(sc4b) smart_crusher_enabled false alone compacts JSON losslessly, drops no row and hides its table, but still registers the tool",
  { options: { smart_crusher_enabled: false, storage_enabled: false } },
  async ($, on) => {
    on("ui.open", notPlaced);
    const registered = await startCrusher(on, $);
    const table = String(JSON.parse(String(await appendResult($, "Bash", BIG)))); // upstream lossless_only: a table, never a dropped row
    expect(table.startsWith("[200]{id:int,note:string,status:string}\n")).toBe(true);
    expect(table).not.toMatch(/_ccr_dropped/);
    expect(registered).toHaveLength(1);
    const text = (await $.command.run({ command: "headroom" })).text ?? "";
    expect(text).not.toMatch(/^smart crusher/m);
    expect(text).toMatch(DEDUP_ROW);
    expect(text).toMatch(ELIDER_ROW);
    expect(text).toMatch(COMPACTION_ROW);
  },
);

test("(sc5) a row's array content gets only its JSON text block rewritten", { options: LOSSY }, async ($, on) => {
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
  await startCrusher(on, $);
  const content = (await appendResult($, "mcp__srv__list", [{ type: "text", text: BIG }, image])) as { text?: string }[];
  expect(crushedRows(content[0].text).rows.length).toBeLessThan(200);
  expect(content[1]).toEqual(image);
});

test("(sc6) a subagent row is crushed by default, and the subagent's effort routing is unchanged", { options: LOSSY }, async ($, on) => {
  const st = bottomStep(on);
  on("tool.call", () => ({ result: "ok" }));
  await startCrusher(on, $);
  expect(crushedRows(await appendResult($, "Bash", BIG, { agentId: "a1" })).rows.length).toBeLessThan(200);
  await callRead($, "a1");
  await step($, 1, "high", "a1");
  expect(st.seen).toBe("low");
});

test("(sc6b) subagent_compression_enabled false stores a subagent row untouched but still crushes a main-loop row", { options: { ...LOSSY, subagent_compression_enabled: false } }, async ($, on) => {
  const st = bottomStep(on);
  on("tool.call", () => ({ result: "ok" }));
  await startCrusher(on, $);
  expect(await appendResult($, "Bash", BIG, { agentId: "a1" })).toBe(BIG);
  expect(crushedRows(await appendResult($, "Bash", BIG)).rows.length).toBeLessThan(200);
  await callRead($, "a1");
  await step($, 1, "high", "a1");
  expect(st.seen).toBe("low"); // subagent effort routing is its own toggle
});

test("(sc7) no row is rewritten when headroom_retrieve registered under another name", async ($, on) => {
  await startCrusher(on, $, "mcp__other__headroom_retrieve");
  expect(await appendResult($, "Bash", BIG)).toBe(BIG);
  expect(await appendResult($, "Bash", DENSE)).toBe(DENSE);
});

test("(sc8) any tool's JSON row is crushed, but headroom_retrieve and the mod's own storage rows are not", { options: LOSSY }, async ($, on) => {
  await startCrusher(on, $);
  expect(crushedRows(await appendResult($, "WebFetch", BIG)).rows.length).toBeLessThan(200);
  expect(await appendResult($, RETRIEVE_TOOL, BIG)).toBe(BIG);
  expect(await appendResult($, "mcp__plugin_inline-headroom_storage__kv_get", BIG)).toBe(BIG);
});

test(
  "(sc9) with only the crusher on, its hook still runs and the pane shows its table without reading storage",
  {
    options: {
      ...NEW_LEVERS_OFF,
      effort_routing_enabled: false,
      cache_aligner_enabled: false,
      lossless_compaction_enabled: false,
      cross_turn_dedup_enabled: false,
      dense_line_elider_enabled: false,
      config_compressor_enabled: false,
      html_extractor_enabled: false,
    },
  },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW });
    const calls = stubWindows(on, () => windowSums(dayKey(NOW)));
    on("ui.open", async () => ({ value: { isPlaced: true as const } }));
    await startCrusher(on, $);
    expect(crushedRows(await appendResult($, "Bash", BIG)).rows.length).toBeLessThan(200);
    await $.command.run({ command: "headroom" });
    await clock.advance(30_000); // no refresh timer runs
    const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
    expect(await ui.find({ type: "Text", text: /^smart crusher$/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^effort routing$/ })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: /^dedup$/ })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: /^line elider$/ })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: /are off: nothing to show/ })).toBeUndefined();
    expect(calls).toHaveLength(0);
    await ui.unmount();
  },
);

test("(sc11) a crush redraws an open /headroom pane", { options: { ...LOSSY, storage_enabled: false } }, async ($, on) => {
  let redraws = 0;
  on("ui.invalidate", async () => {
    redraws++;
    return { value: undefined };
  });
  on("ui.open", async () => ({ value: { isPlaced: true as const } }));
  await startCrusher(on, $);
  await $.command.run({ command: "headroom" });
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  const before = redraws;
  expect(crushedRows(await appendResult($, "Bash", BIG)).rows.length).toBeLessThan(200);
  expect(redraws).toBe(before + 1);
  await ui.unmount();
});

test(
  "(sc12) with only the crusher on, the pane asks for its own height and shows no storage note",
  {
    options: {
      ...NEW_LEVERS_OFF,
      effort_routing_enabled: false,
      cache_aligner_enabled: false,
      lossless_compaction_enabled: false,
      cross_turn_dedup_enabled: false,
      dense_line_elider_enabled: false,
      config_compressor_enabled: false,
      html_extractor_enabled: false,
      storage_enabled: false,
    },
  },
  async ($, on) => {
    const opened: { rows?: number }[] = [];
    on("ui.open", async (_$, e) => {
      opened.push(e);
      return { value: { isPlaced: true as const } };
    });
    await startCrusher(on, $);
    await $.command.run({ command: "headroom" });
    expect(opened[0].rows).toBe(2); // the crusher table's 2 rows
    const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
    expect(await ui.find({ type: "Text", text: /^smart crusher$/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /storage is off/ })).toBeUndefined();
    await ui.unmount();
  },
);

test("(sc10) session.end starts the smart crusher row over", { options: { ...LOSSY, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  on("session.end", async (_$, e) => ({ sessionId: e.sessionId }));
  await startCrusher(on, $);
  await appendResult($, "Bash", BIG);
  const [, before] = CRUSHER_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(before)).toBeGreaterThan(0);
  await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
  expect((await $.command.run({ command: "headroom" })).text).toMatch(/^smart crusher\s+dropped\s+saved\nsession\s+0\s+0$/m);
});

test("(dd1) a row repeating 10 lines of an earlier row is stored with one pointer, and the run is retrievable", { options: { ...NEW_LEVERS_OFF, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  expect(await appendResult($, "Bash", TEN)).toBe(TEN);
  const [head, ptr, ...rest] = String(await appendResult($, "Bash", `header line\n${TEN}`)).split("\n");
  expect(head).toBe("header line");
  expect(rest).toEqual([]);
  const [, n, ref, hash] = POINTER.exec(ptr ?? "") ?? [];
  expect(Number(n)).toBe(10);
  expect(Number(ref)).toBe(1);
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash })).result).toBe(TEN);
  const [, spans, saved] = DEDUP_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(spans)).toBe(1);
  expect(Number(saved)).toBeGreaterThan(0);
});

test("(dd2) a subagent row never folds against the main loop, only against that subagent's own rows", { options: NEW_LEVERS_OFF }, async ($, on) => {
  await startCrusher(on, $);
  await appendResult($, "Bash", TEN);
  expect(await appendResult($, "Bash", TEN, { agentId: "a1" })).toBe(TEN);
  expect(String(await appendResult($, "Bash", TEN, { agentId: "a1" }))).toMatch(POINTER);
});

test("(dd3) cross_turn_dedup_enabled false folds nothing and hides the dedup table", { options: { ...NEW_LEVERS_OFF, cross_turn_dedup_enabled: false, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  await appendResult($, "Bash", TEN);
  expect(await appendResult($, "Bash", TEN)).toBe(TEN);
  expect((await $.command.run({ command: "headroom" })).text).not.toMatch(/^dedup/m);
});

test("(dd4) session.end starts the dedup row and its corpus over", { options: { ...NEW_LEVERS_OFF, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  on("session.end", async (_$, e) => ({ sessionId: e.sessionId }));
  await startCrusher(on, $);
  await appendResult($, "Bash", TEN);
  await appendResult($, "Bash", TEN);
  expect((await $.command.run({ command: "headroom" })).text).toMatch(/^dedup\s+spans\s+saved\nsession\s+1\s+\d+$/m);
  await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
  expect((await $.command.run({ command: "headroom" })).text).toMatch(/^dedup\s+spans\s+saved\nsession\s+0\s+0$/m);
  expect(await appendResult($, "Bash", TEN)).toBe(TEN); // the corpus was cleared: nothing earlier to fold against
});

// The kit raises session.compact with exactly the args it is given, so a test passes the engine's own fields (trigger, agentId, messages) too.
const SUMMARY = { role: "user" as const, text: "summary", toolUses: [] };
const compact = ($: Engine, trigger: string, agentId?: string) => $.session.compact({ trigger, messages: [SUMMARY], ...(agentId === undefined ? {} : { agentId }) } as never);

test(
  "(dd5) a compaction starts only the compacting loop's dedup corpus over and keeps its ordinals, a skipped or precompute one keeps it",
  { options: { ...NEW_LEVERS_OFF, storage_enabled: false } },
  async ($, on) => {
    let skip: string | undefined;
    on("session.compact", async () => (skip === undefined ? { messages: [SUMMARY] } : { skip }));
    await startCrusher(on, $);
    await appendResult($, "Bash", TEN); // main result 1
    await appendResult($, "Bash", TEN, { agentId: "a1" }); // a1's result 1
    skip = "off";
    await compact($, "manual");
    skip = undefined;
    await compact($, "precompute");
    expect(String(await appendResult($, "Bash", TEN))).toMatch(POINTER); // main result 2: neither compaction touched the corpus
    await compact($, "auto", "a1");
    expect(await appendResult($, "Bash", TEN, { agentId: "a1" })).toBe(TEN); // a1's corpus is gone
    expect(String(await appendResult($, "Bash", TEN))).toMatch(POINTER); // main result 3: its corpus is not
    await compact($, "manual");
    expect(await appendResult($, "Bash", TEN)).toBe(TEN); // main result 4: nothing earlier to fold against
    const [, , ref] = POINTER.exec(String(await appendResult($, "Bash", TEN))) ?? [];
    expect(Number(ref)).toBe(4); // result 5 names result 4: the ordinals went on
  },
);

// `n` distinct 3-line runs numbered from `from`, each followed by a separator line: two rows with the same runs and different `sep` fold each run into its own pointer.
const runsRow = (n: number, from: number, sep: string) =>
  Array.from({ length: n }, (_, i) => {
    const k = from + i;
    return [`run ${k} line one of the shared text`, `run ${k} line two of the shared text`, `run ${k} line three of the shared text`, `separator ${sep} ${k}`].join("\n");
  }).join("\n");
const hashesOf = (text: unknown): string[] => [...String(text).matchAll(/ hash=([0-9a-f]{12})\]/g)].map((m) => m[1]);

test("(dd7) dedup runs have a store of their own, so a flood of them never evicts a crushed original", { options: { ...NEW_LEVERS_OFF, ...LOSSY, storage_enabled: false } }, async ($, on) => {
  await startCrusher(on, $);
  const { hash } = crushedRows(await appendResult($, "Bash", BIG));
  await appendResult($, "Bash", runsRow(600, 0, "a"));
  const first = hashesOf(await appendResult($, "Bash", runsRow(600, 0, "b")));
  await appendResult($, "Bash", runsRow(600, 600, "a"));
  const last = hashesOf(await appendResult($, "Bash", runsRow(600, 600, "b")));
  expect([first.length, last.length]).toEqual([600, 600]);
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash })).result).toBe(BIG); // 1200 runs went through the store of 1000
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash: last[599] })).result).toBe(runsRow(1, 1199, "b").split("\n").slice(0, 3).join("\n"));
  expect(typeof (await $.tool.call({ tool: RETRIEVE_TOOL, hash: first[0] })).deny).toBe("string"); // the oldest runs went
});

test("(dd9) a row folding more runs than the store holds keeps every one of its own pointers retrievable", { options: { ...NEW_LEVERS_OFF, storage_enabled: false } }, async ($, on) => {
  await startCrusher(on, $);
  await appendResult($, "Bash", runsRow(1001, 0, "a"));
  const hashes = hashesOf(await appendResult($, "Bash", runsRow(1001, 0, "b")));
  expect(hashes).toHaveLength(1001);
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash: hashes[0] })).result).toBe(runsRow(1, 0, "b").split("\n").slice(0, 3).join("\n"));
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash: hashes[1000] })).result).toBe(runsRow(1, 1000, "b").split("\n").slice(0, 3).join("\n"));
});

test(
  "(dd6) a finished agent's turn.complete starts its dedup corpus over, with every other hook of that event off, and leaves the main loop's",
  { options: { ...NEW_LEVERS_OFF, storage_enabled: false, subagent_effort_routing_enabled: false } },
  async ($, on) => {
    on("turn.complete", async () => ({ text: "" }));
    await startCrusher(on, $);
    await appendResult($, "Bash", TEN);
    await appendResult($, "Bash", TEN, { agentId: "a1" }); // a1's result 1
    await $.turn.complete({ ...DONE, agentId: "a1" });
    expect(await appendResult($, "Bash", TEN, { agentId: "a1" })).toBe(TEN); // a1's result 2: nothing earlier to fold against
    expect(String(await appendResult($, "Bash", TEN, { agentId: "a1" }))).toMatch(/same as result 2: /);
    expect(String(await appendResult($, "Bash", TEN))).toMatch(POINTER); // the main loop's corpus stayed
  },
);

test("(de1) a dense line is stored elided with a retrieval line, and the original is retrievable", { options: { storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  const lines = String(await appendResult($, "Bash", DENSE)).split("\n");
  expect(lines).toHaveLength(3);
  expect(lines[0]).toBe(`${"x".repeat(160)} ...[2260 chars of dense machine-generated content elided]... ${"x".repeat(80)}`);
  expect(lines[1]).toBe("exit 0");
  const [, hash] = /^\[1 dense machine-generated line elided\. Retrieve original: hash=([0-9a-f]{12})\]$/.exec(lines[2] ?? "") ?? [];
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash })).result).toBe(DENSE);
  const [, n, saved] = ELIDER_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(n)).toBe(1);
  expect(Number(saved)).toBeGreaterThan(0);
});

test("(de2) dense_line_elider_enabled false keeps dense lines and hides the line elider table", { options: { dense_line_elider_enabled: false, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  expect(await appendResult($, "Bash", DENSE)).toBe(DENSE);
  expect((await $.command.run({ command: "headroom" })).text).not.toMatch(/^line elider/m);
});

test("(lc1) by default a uniform JSON array is stored as a lossless table, counted under compaction and not under the crusher", { options: { storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  const stored = String(await appendResult($, "Bash", BIG));
  const table = JSON.parse(stored) as unknown; // a JSON string literal, upstream's wrapper for a top-level array
  expect(typeof table).toBe("string");
  expect(String(table).startsWith("[200]{id:int,note:string,status:string}\n")).toBe(true);
  expect(String(table).split("\n").includes("150,same text,error")).toBe(true);
  expect(stored).not.toMatch(/_ccr_dropped/);
  const text = (await $.command.run({ command: "headroom" })).text ?? "";
  const [, arrays, saved] = COMPACTION_ROW.exec(text) ?? [];
  expect(Number(arrays)).toBe(1);
  expect(Number(saved)).toBe(BIG.length - stored.length);
  expect(text).toMatch(/^smart crusher\s+dropped\s+saved\nsession\s+0\s+0$/m);
});

test("(lc2) lossless_compaction_enabled false sends a uniform JSON array to the lossy crusher and hides the compaction table", { options: { ...LOSSY, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  const { rows, dropped } = crushedRows(await appendResult($, "Bash", BIG));
  expect(rows.length).toBeLessThan(200);
  expect(dropped).toBeGreaterThan(0);
  expect((await $.command.run({ command: "headroom" })).text).not.toMatch(/^compaction/m);
});

// A commented k8s manifest whose container stanzas repeat: the config compressor elides the comments and folds the stanzas.
const CONFIG = [
  "# web tier deployment, owned by the platform team; change it only through the release pipeline",
  "apiVersion: apps/v1",
  "kind: Deployment",
  "metadata:",
  "  name: web",
  "spec:",
  "  replicas: 3",
  "  template:",
  "    spec:",
  "      containers:",
  ...[1, 2, 3].flatMap((n) => [`        - name: web-${n}`, "          image: nginx:1.25", "          resources:", "            limits:", "              cpu: 500m", "              memory: 512Mi"]),
  "",
].join("\n");
const CONFIG_ROW = /^config\s+texts\s+saved\nsession\s+(\d+)\s+(\d+)$/m;

test("(cc1) a YAML row is stored config-compressed, its original is retrievable, and /headroom counts it", { options: { storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  const stored = String(await appendResult($, "Bash", CONFIG));
  expect(stored).toMatch(/lines back\)$/m);
  const [, hash] = /\[1 comment\/blank lines elided\. Retrieve original: hash=([0-9a-f]{12})\]$/m.exec(stored) ?? [];
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash })).result).toBe(CONFIG);
  const [, texts, saved] = CONFIG_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(texts)).toBe(1);
  expect(Number(saved)).toBe(CONFIG.length - stored.length);
});

test("(cc2) config_compressor_enabled false keeps a YAML row whole and hides the config table", { options: { config_compressor_enabled: false, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  expect(await appendResult($, "Bash", CONFIG)).toBe(CONFIG);
  expect((await $.command.run({ command: "headroom" })).text).not.toMatch(/^config/m);
});

// A small web page: its head, script, navigation and footer are boilerplate the HTML extractor drops.
const HTML_PAGE = [
  "<!DOCTYPE html>",
  "<html><head><title>Docs</title><style>body { font-family: sans-serif; margin: 0 auto; max-width: 60em; }</style>",
  '<script>window.analytics = { id: "UA-000000", track: function () { return true; } };</script></head>',
  '<body><nav><a href="/">Home</a> <a href="/docs">Docs</a></nav>',
  "<main><h1>Install</h1><p>Run the installer, then restart the service.</p><ul><li>Linux</li><li>macOS</li></ul></main>",
  "<footer>Copyright 2026 Example Corp. All rights reserved.</footer></body></html>",
].join("\n");
const EXTRACTOR_ROW = /^html extractor\s+pages\s+saved\nsession\s+(\d+)\s+(\d+)$/m;

test("(hx1) an HTML row is stored as extracted text, its page is retrievable, and /headroom counts it", { options: { storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  const stored = String(await appendResult($, "Bash", HTML_PAGE));
  const [, hash] = /\n\[HTML extracted to text: \d+ characters of markup removed\. Retrieve original: hash=([0-9a-f]{12})\]$/.exec(stored) ?? [];
  expect(stored.startsWith("# Install\n\nRun the installer, then restart the service.\n\n- Linux\n- macOS\n")).toBe(true);
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash })).result).toBe(HTML_PAGE);
  const [, pages, saved] = EXTRACTOR_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(pages)).toBe(1);
  expect(Number(saved)).toBe(HTML_PAGE.length - stored.length);
});

test("(hx2) html_extractor_enabled false keeps an HTML row whole and hides the html extractor table", { options: { html_extractor_enabled: false, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  expect(await appendResult($, "Bash", HTML_PAGE)).toBe(HTML_PAGE);
  expect((await $.command.run({ command: "headroom" })).text).not.toMatch(/^html extractor/m);
});

// One dense line with a workflow tag in its middle, then a short line.
const TAGGED = `${"x".repeat(1200)}<system-reminder>keep this reminder whole</system-reminder>${"y".repeat(1200)}\nexit 0`;

test("(tp1) tag_protector_enabled false lets the elider cut a dense line holding a custom tag", { options: { tag_protector_enabled: false, storage_enabled: false } }, async ($, on) => {
  await startCrusher(on, $);
  const stored = String(await appendResult($, "Bash", TAGGED));
  expect(stored).not.toMatch(/<system-reminder>keep this reminder whole<\/system-reminder>/);
  expect(stored).toMatch(/\n\[1 dense machine-generated line elided\. Retrieve original: hash=[0-9a-f]{12}\]$/);
});

test("(tp2) by default a dense line holding a custom tag is stored whole", { options: { storage_enabled: false } }, async ($, on) => {
  await startCrusher(on, $);
  expect(await appendResult($, "Bash", TAGGED)).toBe(TAGGED);
});
// A build log: 60 distinct INFO lines and one linker error, with no repeated line for the lossless fold to collapse.
const BUILD_LOG = [...Array.from({ length: 60 }, (_, i) => `INFO step ${i}: compiled module_${i} into build/out_${i}.o`), "ERROR linker exited with code 1"].join("\n");
const LOGS_ROW = /^logs\s+texts\s+saved\nsession\s+(\d+)\s+(\d+)$/m;

test("(lg1) a build log is stored compressed, its original is retrievable, and /headroom counts it", { options: { storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  const stored = String(await appendResult($, "Bash", BUILD_LOG));
  expect(stored).toMatch(/^ERROR linker exited with code 1$/m);
  const [, hash] = /\n\[61 lines compressed to \d+\. Retrieve original: hash=([0-9a-f]{12})\]$/.exec(stored) ?? [];
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash })).result).toBe(BUILD_LOG);
  const [, texts, saved] = LOGS_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(texts)).toBe(1);
  expect(Number(saved)).toBe(BUILD_LOG.length - stored.length);
});

test("(lg2) log_compressor_enabled false keeps a build log whole and hides the logs table", { options: { log_compressor_enabled: false, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  expect(await appendResult($, "Bash", BUILD_LOG)).toBe(BUILD_LOG);
  expect((await $.command.run({ command: "headroom" })).text).not.toMatch(/^logs/m);
});
// A grep dump: 40 matches in each of three files, more than the search compressor keeps.
const GREP = ["src/alpha.py", "src/beta.py", "src/gamma.py"]
  .flatMap((f) => Array.from({ length: 40 }, (_, i) => `${f}:${(i + 1) * 3}:    value_${i + 1} = compute_${i + 1}(argument_${(i + 1) * 7})`))
  .join("\n");
const SEARCH_ROW = /^search\s+texts\s+saved\nsession\s+(\d+)\s+(\d+)$/m;

test("(sr1) a grep dump is stored compressed, its original is retrievable, and /headroom counts it", { options: { storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  const stored = String(await appendResult($, "Bash", GREP));
  expect(stored).toMatch(/^\[\.\.\. and 35 more matches in src\/alpha\.py\]$/m);
  const [, hash] = /\n\[120 matches compressed to 15\. Retrieve original: hash=([0-9a-f]{12})\]$/.exec(stored) ?? [];
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash })).result).toBe(GREP);
  const [, texts, saved] = SEARCH_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(texts)).toBe(1);
  expect(Number(saved)).toBe(GREP.length - stored.length);
});

test("(sr2) search_compressor_enabled false keeps a grep dump whole and hides the search table", { options: { search_compressor_enabled: false, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  expect(await appendResult($, "Bash", GREP)).toBe(GREP);
  expect((await $.command.run({ command: "headroom" })).text).not.toMatch(/^search/m);
});
// A real git diff shape: git's index line and one file with 15 hunks, more than the diff compressor keeps per file.
const GIT_DIFF = [
  "diff --git a/big.py b/big.py",
  "index 3b18e512dba79e4c8300dd08aeb37f8e728b8dad..af5626b4a114abcb82d63db7c8082c3c4756e51b 100644",
  "--- a/big.py",
  "+++ b/big.py",
  ...Array.from({ length: 15 }, (_, i) => [`@@ -${i * 100 + 1},6 +${i * 100 + 1},6 @@`, ` ctx_a_${i}`, ` ctx_b_${i}`, `-old_${i}`, `+new_${i}`, ` ctx_c_${i}`, ` ctx_d_${i}`]).flat(),
  "",
].join("\n");
const DIFF_ROW = /^diff\s+texts\s+saved\nsession\s+(\d+)\s+(\d+)$/m;

test("(df1) a git diff is stored compressed over its index-strip fold, its original is retrievable, and /headroom counts it", { options: { storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  const stored = String(await appendResult($, "Bash", GIT_DIFF));
  expect(stored).not.toMatch(/^index /m);
  expect(stored).toMatch(/^\[1 files changed, \+15 -15 lines, 5 hunks omitted\]$/m);
  const [, hash] = /\n\[110 lines compressed to \d+\. Retrieve original: hash=([0-9a-f]{12})\]$/.exec(stored) ?? [];
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash })).result).toBe(GIT_DIFF);
  const [, texts, saved] = DIFF_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(texts)).toBe(1);
  expect(Number(saved)).toBe(GIT_DIFF.length - stored.length);
});

test("(df2) diff_compressor_enabled false keeps a git diff whole and hides the diff table", { options: { diff_compressor_enabled: false, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  expect(await appendResult($, "Bash", GIT_DIFF)).toBe(GIT_DIFF);
  expect((await $.command.run({ command: "headroom" })).text).not.toMatch(/^diff/m);
});
// A subagent-style prose report: twelve distinct sentences, no repeated line for the lossless fold to collapse.
const REPORT = Array.from({ length: 12 }, (_, i) => `Finding ${i + 1} describes how the ${["cache", "queue", "router", "parser"][i % 4]} module behaves under ${i * 10} percent load.`).join("\n");
const TEXT_ROW = /^text crusher\s+texts\s+saved\nsession\s+(\d+)\s+(\d+)$/m;
const CRUSHED = /\n\[Text crushed: \d+ of (\d+) segments kept\. Retrieve original: hash=([0-9a-f]{12})\]$/;

test("(tc1) a prose report is stored crushed, its original is retrievable, and /headroom counts it", { options: { storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  const stored = String(await appendResult($, "Bash", REPORT));
  const [, total, hash] = CRUSHED.exec(stored) ?? [];
  expect(Number(total)).toBe(12);
  expect(String(await appendResult($, "Agent", REPORT))).not.toMatch(CRUSHED); // an Agent report is never crushed (dedup may still fold it)
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash })).result).toBe(REPORT);
  const [, texts, saved] = TEXT_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(texts)).toBe(1);
  expect(Number(saved)).toBe(REPORT.length - stored.length);
});

test("(tc2) text_crusher_enabled false keeps a prose report whole and hides the text crusher table", { options: { text_crusher_enabled: false, storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $);
  expect(await appendResult($, "Agent", REPORT)).toBe(REPORT);
  expect((await $.command.run({ command: "headroom" })).text).not.toMatch(/^text crusher/m);
});

test("(tc3) by default dedup indexes the crushed form: a repeated prose row is crushed the same way, then folded into one pointer", { options: { storage_enabled: false } }, async ($, on) => {
  await startCrusher(on, $);
  const first = String(await appendResult($, "Bash", REPORT));
  expect(first).toMatch(CRUSHED);
  expect(String(await appendResult($, "Bash", REPORT))).toMatch(POINTER);
});
// Prose records: three about the oauth token refresh, two about widgets; the user asked about the refresh.
const OAUTH_NOTES = [
  "The oauth token refresh runs every ten minutes from the scheduler service.\n\n",
  "The widget gallery renders thumbnails in a responsive grid layout for every visitor.\nIt uses lazy loading for images below the fold of the page to save bandwidth.\n\n",
  "Refreshing the oauth token needs the client secret from the vault.\n\n",
  "Colour themes for widgets live in a separate stylesheet bundle with many variables.\nDark mode swaps the whole palette through custom properties on the root element.\n\n",
  "A refreshed oauth token is cached for the lifetime of the session.\n",
].join("");
const OAUTH_ASK = "why does the oauth token refresh break";
const SPLIT_ROW = /^relevance split\s+texts\s+saved\nsession\s+(\d+)\s+(\d+)$/m;

test("(rs1) prose is split by the user's request, the original is retrievable, and /headroom counts it", { options: { storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  await startCrusher(on, $, RETRIEVE_TOOL, OAUTH_ASK);
  const stored = String(await appendResult($, "Bash", OAUTH_NOTES));
  expect(stored).toMatch(/^\.\.\.\[3 low-relevance lines elided\]\.\.\.$/m);
  expect(stored).toMatch(/^A refreshed oauth token is cached for the lifetime of the session\.$/m);
  const [, hash] = /\n\[6 low-relevance lines in 2 runs elided\. Retrieve original: hash=([0-9a-f]{12})\]$/.exec(stored) ?? [];
  expect((await $.tool.call({ tool: RETRIEVE_TOOL, hash })).result).toBe(OAUTH_NOTES);
  const [, texts, saved] = SPLIT_ROW.exec((await $.command.run({ command: "headroom" })).text ?? "") ?? [];
  expect(Number(texts)).toBe(1);
  expect(Number(saved)).toBe(OAUTH_NOTES.length - stored.length);
});

test(
  "(rs2) relevance_split_enabled false keeps prose whole (with the text crusher off too) and hides the relevance split table",
  { options: { relevance_split_enabled: false, text_crusher_enabled: false, storage_enabled: false } },
  async ($, on) => {
    on("ui.open", notPlaced);
    await startCrusher(on, $, RETRIEVE_TOOL, OAUTH_ASK);
    expect(await appendResult($, "Bash", OAUTH_NOTES)).toBe(OAUTH_NOTES);
    expect((await $.command.run({ command: "headroom" })).text).not.toMatch(/^relevance split/m);
  },
);

test("(rs3) session.end starts the logs, search, diff, text crusher and relevance split rows over", { options: { storage_enabled: false } }, async ($, on) => {
  on("ui.open", notPlaced);
  on("session.end", async (_$, e) => ({ sessionId: e.sessionId }));
  await startCrusher(on, $, RETRIEVE_TOOL, OAUTH_ASK);
  for (const text of [BUILD_LOG, GREP, GIT_DIFF, REPORT, OAUTH_NOTES]) await appendResult($, "Bash", text);
  const rows = [LOGS_ROW, SEARCH_ROW, DIFF_ROW, TEXT_ROW, SPLIT_ROW];
  const before = (await $.command.run({ command: "headroom" })).text ?? "";
  for (const row of rows) expect(Number(row.exec(before)?.[1])).toBe(1);
  await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
  const after = (await $.command.run({ command: "headroom" })).text ?? "";
  for (const row of rows) expect(row.exec(after)?.slice(1)).toEqual(["0", "0"]);
});
