import type { EngineInterface, Register } from "claude-code";
import { RETAIN_DAYS, VIEWS, cacheHitRatio, clampEffort, dayKey, findVolatile, foldPending, isCacheDrop, isToolError, toCount, viewTitle, windowStart, zeroCounters } from "./policy.mjs";
import type { Counters, View, VolatileFinding } from "./policy.mjs";

// Module state resets on hot reload and on an options change (the engine reloads the module).
// Persisted totals survive: each load writes its own rows under a new WRITER.
let toolErrored = false; // any main-loop tool error since the last main-loop step
// The Session view: this session's counters, in memory.
const stats = {
  steps: 0,
  clamped: 0,
  cacheDrops: 0,
  lastHit: undefined as number | undefined,
  volatile: [] as VolatileFinding[],
};
const WRITER = Math.random().toString(36).slice(2).padEnd(8, "0"); // this module instance's stats rows
const pending: Counters = zeroCounters(); // counter deltas since the last fold
const days: Record<string, Counters> = {}; // this writer's per-day totals that may still need writing
let flushing: Promise<void> = Promise.resolve(); // serializes stats_put: a newer snapshot always lands after an older one
let view: View = "session"; // the pane's view; every /headroom resets it
type Sums = { view: View; today?: string; data?: Counters; error?: string };
let sums: Sums | undefined; // the last aggregate view's totals, fetched outside render

const pct = (n: number | undefined): string => (n === undefined ? "–" : `${Math.round(n * 100)}%`);
const PANE = "headroom"; // the /headroom pane's id (1-64 of letters, digits, _ and -)
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// The engine refuses $.<noun> as a bare value, so same-file helpers take the whole $.
// Resolves the op's result; rejects with the server's message on a refusal or an error result.
const callStorage = async ($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<unknown> => {
  const c = await $.mcp.connect("plugin:inline-headroom:storage"); // a plugin's server is namespaced, not the bare .mcp.json key
  if (!c.isConnected) throw new Error(c.message);
  const r = await $.mcp.call(c.server, tool, args);
  if (r.isError) throw new Error(r.content[0]?.text ?? "storage call failed");
  // structuredContent is documented only for tools with an outputSchema; the text block carries the same JSON.
  return r.structuredContent ?? JSON.parse(r.content[0]?.text ?? "null");
};

// Fetches one aggregate view's sums into `sums`; a result that arrives after the view changed is dropped.
const loadSums = async ($: EngineInterface, now: number, v: View): Promise<void> => {
  const today = dayKey(now);
  if (sums?.view !== v) sums = { view: v, today }; // loading (a refresh keeps the old numbers on screen)
  let next: Sums;
  try {
    const span = VIEWS.find((x) => x.id === v)?.days ?? 1;
    next = { view: v, today, data: (await callStorage($, "stats_sum", { since: windowStart(today, span) })) as Counters };
  } catch (err) {
    next = { view: v, today, error: message(err) };
  }
  if (view === v) sums = next;
};

export const register: Register = (on, options) => {
  const effortOn = options.effort_routing_enabled !== false;
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

  // One row per finding, so a long list wraps per row instead of one clipped line.
  const sessionLines = (): string[] => [
    `effort routing: ${effortOn ? "on" : "off"} · main-loop steps ${stats.steps} · clamped ${stats.clamped}`,
    `cache aligner: ${cacheOn ? "on" : "off"} · last hit ${pct(stats.lastHit)} · drops ${stats.cacheDrops}`,
    stats.volatile.length ? "volatile shared values:" : "volatile shared values: none",
    ...stats.volatile.map((v) => `  ${v.id} ${v.kind} ${v.sample}`),
  ];

  // Today / 7 days / 30 days: totals across every session on this host, read from storage.
  const aggregateLines = (): string[] => {
    if (!storageOn) return ["storage is off (storage_enabled is not true): only the Session view is kept"];
    if (sums?.view !== view) return ["loading…"];
    if (sums.error !== undefined) return [`storage unavailable: ${sums.error}`];
    if (!sums.data) return ["loading…"];
    const d = sums.data;
    return [`main-loop steps ${d.steps} · clamped ${d.clamped}`, `cache hit ${pct(cacheHitRatio(d))} · drops ${d.cache_drops}`];
  };

  on("command.run", { command: "headroom" }, async ($) => {
    view = "session"; // every /headroom opens on the default view
    $.ui.invalidate("ui.render"); // an already-open pane redraws on it
    const r = await $.ui.open({ id: PANE, title: "Headroom", focus: true, closeOnEscape: true });
    // Pane placed: print nothing (no transcript line, nothing in the model's context).
    // Not placed (headless/SDK, narrow terminal): fall back to the plain text, always the Session view.
    return r.isPlaced ? {} : { text: [`showing: ${viewTitle("session")}`, ...sessionLines()].join("\n") };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e);
    // Every way to press a Button raises the same onPress; the active view's label is drawn at full strength.
    const switcher = Box({
      flexDirection: "row",
      gap: 2,
      flexWrap: "wrap",
      children: VIEWS.map((v, i) =>
        Button({
          key: v.id,
          label: v.label,
          hotkey: String(i + 1),
          plain: true,
          dimColor: v.id !== view,
          onPress: async () => {
            // Nobody awaits this handler, so it must never reject (an unhandled rejection can be fatal).
            try {
              view = v.id;
              $.ui.invalidate("ui.render");
              if (v.id === "session" || !storageOn) return;
              await loadSums($, await $.clock.now(), v.id);
              $.ui.invalidate("ui.render");
            } catch (err) {
              // The clock or an invalidate failed outside loadSums' own error handling: say why instead of "loading…".
              if (view === v.id) sums = { view: v.id, error: message(err) };
              try {
                $.ui.invalidate("ui.render");
              } catch {
                // $ itself is refused: nothing is left to redraw with
              }
            }
          },
        }),
      ),
    });
    const rows = [`showing: ${viewTitle(view, sums?.view === view ? sums.today : undefined)}`, ...(view === "session" ? sessionLines() : aggregateLines())];
    return Box({ flexDirection: "column", children: [switcher, ...rows.map((s) => Text({ children: [s] }))] });
  });

  if (effortOn) {
    // Observe AFTER the tool ran. Subagent calls are ignored; under parallel
    // calls the flag is sticky, so a single error disables the next clamp.
    on("tool.call", async (_$, e, next) => {
      try {
        const r = await next(e);
        if (!e.agentId && isToolError(r)) toolErrored = true;
        return r;
      } catch (err) {
        // A tool that throws instead of returning an error result is still a failure.
        if (!e.agentId) toolErrored = true;
        throw err;
      }
    });
  }

  on("turn.step", async function* ($, e, next) {
    if (e.agentId) return yield* next(e);
    stats.steps += 1;
    pending.steps += 1;
    try {
      let ev = e;
      // ponytail: mid-turn user input (a queued command) arriving at index > 0 is
      // still treated as mechanical; detect it via a prompt/queue event if that matters.
      if (effortOn && e.index > 0 && !toolErrored) {
        const to = clampEffort(e.effort);
        if (to !== undefined) {
          ev = { ...e, effort: to };
          stats.clamped += 1;
          pending.clamped += 1;
        }
      }
      toolErrored = false; // consumed per step; index 0 resets it too
      const result = yield* next(ev);
      if (cacheOn && result?.usage) {
        const u = result.usage;
        pending.input_tokens += toCount(u.input_tokens);
        pending.cache_read_input_tokens += toCount(u.cache_read_input_tokens);
        pending.cache_creation_input_tokens += toCount(u.cache_creation_input_tokens);
        const hit = cacheHitRatio(result.usage);
        if (hit !== undefined) {
          if (isCacheDrop(stats.lastHit, hit)) {
            stats.cacheDrops += 1;
            pending.cache_drops += 1;
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

  if (storageOn) {
    on("turn.complete", async ($, e, next) => {
      const r = await next(e);
      if (e.agentId) return r; // subagent turns carry no main-loop steps
      let now: number;
      let today: string;
      let purgeBefore: string;
      let rows: ReturnType<typeof foldPending>;
      try {
        now = await $.clock.now();
        today = dayKey(now);
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
          if (view === "session") return;
          await loadSums($, now, view);
          $.ui.invalidate("ui.render");
        })
        // The chain must never reject: a rejected `flushing` would skip every later flush for the
        // module's life. A throw after the write (loadSums, invalidate, or `$` refused once the
        // hook has returned) only loses this one pane refresh.
        .catch(() => {});
      return r;
    });
  }

  // /clear and resume go on in this process under a new session id: the Session view starts over.
  // Persisted totals and pending deltas are session-agnostic and carry on.
  on("session.end", async ($, e, next) => {
    Object.assign(stats, { steps: 0, clamped: 0, cacheDrops: 0, lastHit: undefined, volatile: [] });
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
