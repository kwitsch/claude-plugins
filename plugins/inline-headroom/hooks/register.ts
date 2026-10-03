import type { Register } from "claude-code";
import { cacheHitRatio, clampEffort, findVolatile, isCacheDrop, isToolError } from "./policy.mjs";

// Module state: resets on hot reload and on an options change (the engine
// reloads the module). Accepted for 0.1.0; $.state persistence is a follow-up.
let toolErrored = false; // any main-loop tool error since the last main-loop step
const stats = {
  steps: 0,
  clamped: 0,
  cacheDrops: 0,
  lastHit: undefined as number | undefined,
  volatile: [] as { id: string; kind: string; sample: string }[],
};

const pct = (n: number | undefined): string => (n === undefined ? "–" : `${Math.round(n * 100)}%`);

export const register: Register = (on, options) => {
  const effortOn = options.effort_routing_enabled !== false;
  const cacheOn = options.cache_aligner_enabled !== false;

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "headroom",
      description: "inline-headroom stats: effort clamps, cache-hit drops, volatile prompt values",
    });
    return next(e);
  });

  on("command.run", { command: "headroom" }, async () => {
    const volatile = stats.volatile.map((v) => `${v.id} ${v.kind} ${v.sample}`).join(", ") || "none";
    return {
      text: [
        `effort routing: ${effortOn ? "on" : "off"} · main-loop steps ${stats.steps} · clamped ${stats.clamped}`,
        `cache aligner: ${cacheOn ? "on" : "off"} · last hit ${pct(stats.lastHit)} · drops ${stats.cacheDrops}`,
        `volatile shared values: ${volatile}`,
      ].join("\n"),
    };
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
    let ev = e;
    // ponytail: mid-turn user input (a queued command) arriving at index > 0 is
    // still treated as mechanical; detect it via a prompt/queue event if that matters.
    if (effortOn && e.index > 0 && !toolErrored) {
      const to = clampEffort(e.effort);
      if (to !== undefined) {
        ev = { ...e, effort: to };
        stats.clamped += 1;
      }
    }
    toolErrored = false; // consumed per step; index 0 resets it too
    const result = yield* next(ev);
    if (cacheOn && result?.usage) {
      const hit = cacheHitRatio(result.usage);
      if (hit !== undefined) {
        if (isCacheDrop(stats.lastHit, hit)) {
          stats.cacheDrops += 1;
          const ids = [...new Set(stats.volatile.map((v) => v.id))];
          $.ui.log(`cache drop ${pct(stats.lastHit)} → ${pct(hit)} (wrote ${result.usage.cache_creation_input_tokens} tok)` + (ids.length ? ` · volatile: ${ids.join(", ")}` : ""));
        }
        stats.lastHit = hit;
      }
    }
    return result;
  });

  if (cacheOn) {
    // Detector only (upstream CacheAligner): the composed prompt is returned untouched.
    on("prompt.compose", async (_$, e, next) => {
      const r = await next(e);
      stats.volatile = findVolatile(r.sections);
      return r;
    });
  }
};
