import type { EngineInterface, Register, Timer } from "claude-code";
import {
  CELL_WIDTHS,
  RETAIN_DAYS,
  ROWS,
  cacheHitRatio,
  clampEffort,
  dayKey,
  findVolatile,
  foldPending,
  isCacheDrop,
  isToolError,
  pct,
  statsTables,
  tableText,
  toCount,
  windowStart,
  zeroCounters,
} from "./policy.mjs";
import type { Counters, VolatileFinding } from "./policy.mjs";

// Module state resets on hot reload and on an options change (the engine reloads the module).
// Persisted totals survive: each load writes its own rows under a new WRITER.
let toolErrored = false; // any main-loop tool error since the last main-loop step
const agentErrored = new Set<string>(); // subagents with a tool error since their own last step; an entry ends with that agent's turn
const subagents = { steps: 0, clamped: 0 }; // this session's subagent steps: in memory only, never persisted (the stats schema stays main-loop)
// The session row: this session's counters, in memory.
const session: Counters = zeroCounters();
const stats = {
  lastHit: undefined as number | undefined,
  volatile: [] as VolatileFinding[],
};
const WRITER = Math.random().toString(36).slice(2).padEnd(8, "0"); // this module instance's stats rows
const pending: Counters = zeroCounters(); // counter deltas since the last fold
const days: Record<string, Counters> = {}; // this writer's per-day totals that may still need writing
let flushing: Promise<void> = Promise.resolve(); // serializes stats_put: a newer snapshot always lands after an older one
let sums: { data?: Counters[]; error?: string } | undefined; // the today / 7 days / 30 days totals (ROWS order after session), fetched outside render
let loading: Promise<void> | undefined; // the fetch in flight: a tick never stacks on a slow stats_sum (a cold service start takes up to 3 s)
let poll: Timer | undefined; // the open pane's 10 s refresh

const PANE = "headroom"; // the /headroom pane's id (1-64 of letters, digits, _ and -)
const PANE_ROWS = 15; // body height asked for when seated inline: a 6-row and a 5-row table, two gaps, the volatile header, the storage note
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// Moves one counter in the session row and in the deltas still to persist.
const count = (k: keyof Counters, n = 1): void => {
  session[k] += n;
  pending[k] += n;
};

// The engine refuses $.<noun> as a bare value, so same-file helpers take the whole $.
// Resolves the op's result; rejects with the server's message on a refusal or an error result.
const callStorage = async ($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<unknown> => {
  const c = await $.mcp.connect("storage"); // the key in this plugin's .mcp.json; the engine namespaces it and returns the namespaced `server` that `call` takes
  if (!c.isConnected) throw new Error(c.message);
  const r = await $.mcp.call(c.server, tool, args);
  if (r.isError) throw new Error(r.content[0]?.text ?? "storage call failed");
  // structuredContent is documented only for tools with an outputSchema; the text block carries the same JSON.
  return r.structuredContent ?? JSON.parse(r.content[0]?.text ?? "null");
};

// Reads the storage rows into `sums` and redraws the pane. Never rejects: a tick's caller does not await it.
const loadSums = async ($: EngineInterface): Promise<void> => {
  let fetched: typeof sums;
  try {
    const today = dayKey(await $.clock.now()); // read per fetch, so the rows roll over at midnight
    // The session row (days 0) is kept in memory; the rest are storage windows.
    const totals = await Promise.all(ROWS.filter((r) => r.days > 0).map((r) => callStorage($, "stats_sum", { since: windowStart(today, r.days) })));
    fetched = { data: totals as Counters[] }; // a refresh keeps the old numbers on screen until this lands
  } catch (err) {
    // The clock or storage failed: keep the last good numbers under the note, say why instead of "…" forever.
    fetched = { data: sums?.data, error: message(err) };
  }
  const same = JSON.stringify(fetched) === JSON.stringify(sums);
  sums = fetched;
  if (same) return; // an idle session's totals repeat every tick: no redraw for them
  try {
    $.ui.invalidate("ui.render");
  } catch {
    // $ itself is refused: nothing is left to redraw with
  }
};

// A call made while a fetch runs joins it instead of starting another: the engine re-arms every period at callback start, so a slow fetch would overlap the next tick.
const refresh = ($: EngineInterface): Promise<void> => (loading ??= loadSums($).finally(() => (loading = undefined)));

// Starts the open pane's 10 s refresh unless one runs: the command and the first redraw after a hot reload both call it.
const arm = ($: EngineInterface): void => {
  if (poll !== undefined) return;
  void refresh($); // the first numbers now, not after 10 s
  poll = $.clock.every(10_000, () => void refresh($));
};

export const register: Register = (on, options) => {
  const effortOn = options.effort_routing_enabled !== false;
  // Subagent and Workflow-agent steps: their own toggle, active only while effort routing is on.
  const subOn = effortOn && options.subagent_effort_routing_enabled !== false;
  const cacheOn = options.cache_aligner_enabled !== false;
  // Unset means the manifest default (true), like the sibling toggles; the server stays fail-closed.
  const storageOn = options.storage_enabled !== false;

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "headroom",
      description: "inline-headroom stats: effort clamps, cache-hit drops, volatile prompt values",
    });
    return next(e);
  });

  // The storage rows' state when they hold no numbers: off, or the last fetch's error.
  const note = (): string | undefined =>
    !storageOn ? "storage is off (storage_enabled is not true): only the session row is kept" : sums?.error === undefined ? undefined : `storage unavailable: ${sums.error}`;
  // No note means the numbers are still loading ("…"); a note means they never will come ("–").
  // The session row shows its last step's hit ratio; the storage rows are token-weighted over their windows.
  // Each table is shown only while the lever it counts is on; the storage rows sit in both.
  const tables = (): string[][][] => {
    const [effort, cache] = statsTables([{ ...session, hit: stats.lastHit }, ...(sums?.data ?? [])], note() === undefined ? "…" : "–");
    // Under the session row: this session's subagent steps, kept in memory only.
    if (subOn) effort.splice(2, 0, ["subagents", String(subagents.steps), String(subagents.clamped)]);
    return [...(effortOn ? [effort] : []), ...(cacheOn ? [cache] : [])];
  };
  // One row per finding, so a long list wraps per row instead of one clipped line. The list belongs to the cache aligner.
  const volatileLines = (): string[] =>
    !cacheOn ? [] : [stats.volatile.length ? "volatile shared values:" : "volatile shared values: none", ...stats.volatile.map((v) => `  ${v.id} ${v.kind} ${v.sample}`)];
  // With both levers off there is nothing to show, so nothing is read from storage either.
  const idle = (): string | undefined => (effortOn || cacheOn ? undefined : "effort routing and cache aligner are off: nothing to show");
  const rowsShown = storageOn && idle() === undefined;

  on("command.run", { command: "headroom" }, async ($) => {
    const r = await $.ui.open({ id: PANE, title: "Headroom", focus: true, closeOnEscape: true, rows: PANE_ROWS });
    if (r.isPlaced) {
      // Pane placed: print nothing (no transcript line, nothing in the model's context).
      if (rowsShown) {
        poll?.cancel(); // re-opening an open pane restarts its refresh instead of stacking a second one
        poll = undefined;
        arm($);
      }
      return {};
    }
    // Not placed (headless/SDK, narrow terminal): the same tables as text, read from storage once.
    const off = idle();
    if (off !== undefined) return { text: off };
    if (rowsShown) await refresh($);
    const n = note();
    return { text: [tables().map(tableText).join("\n\n"), ...(n === undefined ? [] : [n]), ...volatileLines()].join("\n") };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    if (rowsShown) arm($); // a hot reload leaves the pane open with no timer: its first redraw re-arms the refresh
    const { Box, Text } = $.ui.resolve(e);
    // Box cells, not padded text: the columns line up on every surface, proportional fonts included.
    const table = (rows: string[][]) =>
      Box({
        flexDirection: "column",
        children: rows.map((row, j) =>
          Box({
            flexDirection: "row",
            children: row.map((s, i) =>
              Box({
                width: CELL_WIDTHS[i],
                justifyContent: i ? "flex-end" : "flex-start",
                children: [Text({ bold: j === 0, children: [s] })],
              }),
            ),
          }),
        ),
      });
    const off = idle();
    if (off !== undefined) return Box({ flexDirection: "column", children: [Text({ dimColor: true, children: [off] })] });
    const n = note();
    return Box({
      flexDirection: "column",
      gap: 1,
      children: [
        ...tables().map((t) => table(t)),
        ...(n === undefined ? [] : [Text({ dimColor: true, children: [n] })]),
        Box({ flexDirection: "column", children: volatileLines().map((s) => Text({ children: [s] })) }),
      ],
    });
  });

  // The refresh runs only while the pane is open: Esc, Ctrl+X X and $.ui.close all raise ui.close (an unload close skips the opener's hooks).
  on("ui.close", { id: PANE }, async (_$, e, next) => {
    const r = await next(e);
    // { deny }: a hook beneath kept the pane open, so its refresh keeps running too.
    if (r.deny === undefined) {
      poll?.cancel();
      poll = undefined;
      sums = undefined; // a reopened pane shows "…" until fresh numbers land, not the last session's
    }
    return r;
  });

  if (effortOn) {
    // Observe AFTER the tool ran. A failure keeps full effort on the next step of the loop that made the call:
    // the main loop's flag, or that subagent's entry. Under parallel calls the flag is sticky.
    const failed = (agentId: string | undefined): void => {
      if (!agentId) toolErrored = true;
      else if (subOn) agentErrored.add(agentId);
    };
    on("tool.call", async (_$, e, next) => {
      try {
        const r = await next(e);
        if (isToolError(r)) failed(e.agentId);
        return r;
      } catch (err) {
        // A tool that throws instead of returning an error result is still a failure.
        failed(e.agentId);
        throw err;
      }
    });
  }

  on("turn.step", async function* ($, e, next) {
    const id = e.agentId;
    if (id) {
      if (!subOn) return yield* next(e); // today's behaviour: subagent steps untouched
      subagents.steps++;
      try {
        let ev = e;
        // Same rule as the main loop, per agent: index 0 is the agent's own prompt step.
        if (e.index > 0 && !agentErrored.has(id)) {
          const to = clampEffort(e.effort);
          if (to !== undefined) {
            ev = { ...e, effort: to };
            subagents.clamped++;
          }
        }
        agentErrored.delete(id); // consumed per step, like the main-loop flag
        // No cache-aligner accounting: a subagent's prompt cache is not the main loop's.
        return yield* next(ev);
      } finally {
        $.ui.invalidate("ui.render"); // the subagents row moved, also on a failed step
      }
    }
    count("steps");
    try {
      let ev = e;
      // ponytail: mid-turn user input (a queued command) arriving at index > 0 is
      // still treated as mechanical; detect it via a prompt/queue event if that matters.
      if (effortOn && e.index > 0 && !toolErrored) {
        const to = clampEffort(e.effort);
        if (to !== undefined) {
          ev = { ...e, effort: to };
          count("clamped");
        }
      }
      toolErrored = false; // consumed per step; index 0 resets it too
      const result = yield* next(ev);
      if (cacheOn && result?.usage) {
        const u = result.usage;
        count("input_tokens", toCount(u.input_tokens));
        count("cache_read_input_tokens", toCount(u.cache_read_input_tokens));
        count("cache_creation_input_tokens", toCount(u.cache_creation_input_tokens));
        const hit = cacheHitRatio(result.usage);
        if (hit !== undefined) {
          if (isCacheDrop(stats.lastHit, hit)) {
            count("cache_drops");
            const ids = [...new Set(stats.volatile.map((v) => v.id))];
            $.ui.log(`cache drop ${pct(stats.lastHit)} → ${pct(hit)} (wrote ${result.usage.cache_creation_input_tokens} tok)` + (ids.length ? ` · volatile: ${ids.join(", ")}` : ""));
          }
          stats.lastHit = hit;
        }
      }
      return result;
    } finally {
      // also on a failed or aborted step: steps/clamped moved before it
      $.ui.invalidate("ui.render"); // redraw an open /headroom pane with the new stats
    }
  });

  // One turn.complete hook for both jobs: the engine refuses a second turn.complete without a matcher in one module.
  if (storageOn || subOn) {
    on("turn.complete", async ($, e, next) => {
      // An agent's error entry ends with its turn, also with storage off or a throwing chain. A no-op while subOn is off: the Set stays empty.
      if (e.agentId) agentErrored.delete(e.agentId);
      const r = await next(e);
      if (!storageOn || e.agentId) return r; // subagent turns carry no main-loop steps
      let today: string;
      let purgeBefore: string;
      let rows: ReturnType<typeof foldPending>;
      try {
        today = dayKey(await $.clock.now());
        purgeBefore = windowStart(today, RETAIN_DAYS);
        rows = foldPending(days, pending, today, purgeBefore);
      } catch {
        return r; // stats are a side feature: a bad clock never costs the turn's result
      }
      // Not awaited: a cold service start (up to 3 s) never delays the turn's end.
      flushing = flushing
        .then(async () => {
          try {
            await callStorage($, "stats_put", { writer: WRITER, rows, purgeBefore });
          } catch {
            return; // days keeps every total: the next turn rewrites them
          }
          for (const d of Object.keys(days)) if (d < today) delete days[d]; // final rows, written
          if (poll !== undefined) void refresh($); // an open pane shows the rows just written, not at its next tick
        })
        // The chain must never reject: a rejected `flushing` would skip every later flush for the module's life.
        .catch(() => {});
      return r;
    });
  }

  // /clear and resume go on in this process under a new session id: the session row starts over.
  // Persisted totals and pending deltas are session-agnostic and carry on.
  on("session.end", async ($, e, next) => {
    Object.assign(session, zeroCounters());
    Object.assign(subagents, { steps: 0, clamped: 0 });
    agentErrored.clear(); // an aborted agent whose turn.complete never came
    Object.assign(stats, { lastHit: undefined, volatile: [] });
    $.ui.invalidate("ui.render");
    const r = await next(e);
    // A headless run exits after this chain: let a started stats_put finish. `flushing` never
    // rejects, and the engine's ~1.5 s end bound cuts the wait; core's end step already ran.
    await flushing;
    return r;
  });

  if (cacheOn) {
    // Detector only (upstream CacheAligner): the composed prompt is returned untouched.
    on("prompt.compose", async ($, e, next) => {
      const r = await next(e);
      stats.volatile = findVolatile(r.sections);
      $.ui.invalidate("ui.render");
      return r;
    });
  }
};
