// Pure policy for inline-headroom. Never reference the mods `$` here: the
// engine's validation rejects passing the mods API into functions imported
// from another file. All `$` use lives inside hooks in register.ts. No clock
// reads either: time comes in as arguments.

/** @typedef {'low'|'medium'|'high'|'xhigh'|'max'} Effort */
/** @typedef {'uuid'|'iso8601'|'jwt'|'hex_hash'} VolatileKind */
/** @typedef {{id: string, kind: VolatileKind, sample: string}} VolatileFinding */
/** @typedef {'session'|'day'|'7d'|'30d'} View */
/** @typedef {{steps: number, clamped: number, cache_drops: number, input_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number}} Counters */

export const EFFORT_ORDER = /** @type {const} */ (["low", "medium", "high", "xhigh", "max"]);
export const CACHE_DROP_THRESHOLD = 0.6;
export const MAX_FINDINGS = 10;
/** Pane views in hotkey order (1-4). `days`: the rolling window, today included; 0 = this session, in memory. */
export const VIEWS = /** @type {const} */ ([
  { id: "session", label: "Session", days: 0 },
  { id: "day", label: "Today", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
]);
/** Persisted days kept: the longest view's window, never less. */
export const RETAIN_DAYS = 30;

const TOKEN_SPLIT = /[\s"'`()<>[\]{},;]+/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}.*)?$/;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const HEX_RE = /^[0-9a-f]+$/i;
const HEX_LENGTHS = new Set([32, 40, 64]);
// The persisted counters in mcp/server.mjs STATS_KEYS order. That file stays import-free, so the list is
// repeated on purpose; test/inline-headroom/storage.test.mjs pins both orders.
const COUNTER_KEYS = /** @type {const} */ (["steps", "clamped", "cache_drops", "input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]);
const DAY_MS = 86400000;

/**
 * Clamp-only: returns `target` only when `current` is a known effort level
 * strictly above it; otherwise undefined (absent, numeric, unknown, at/below).
 * @param {unknown} current
 * @param {Effort} [target='low']
 * @returns {Effort|undefined}
 */
export function clampEffort(current, target = "low") {
  if (typeof current !== "string") return undefined;
  const c = EFFORT_ORDER.indexOf(/** @type {Effort} */ (current));
  return c > EFFORT_ORDER.indexOf(target) ? target : undefined;
}

/**
 * A tool.call result is a failure when it is errored or denied.
 * @param {Record<string, unknown>} result
 * @returns {boolean}
 */
export function isToolError(result) {
  return result.isError === true || typeof result.deny === "string";
}

/**
 * Anchored per-token classification (upstream CacheAligner's four classes).
 * @param {string} tok
 * @returns {VolatileKind|undefined}
 */
function classify(tok) {
  if (UUID_RE.test(tok)) return "uuid";
  if (ISO_RE.test(tok) && !Number.isNaN(Date.parse(tok))) return "iso8601";
  if (tok.startsWith("eyJ") && JWT_RE.test(tok)) return "jwt";
  if (HEX_LENGTHS.has(tok.length) && HEX_RE.test(tok)) return "hex_hash";
  return undefined;
}

/**
 * Flags volatile values in the cacheable (`shared`) system-prompt sections.
 * @param {readonly {id: string, text: string, scope: 'shared'|'session'}[]} sections
 * @returns {VolatileFinding[]}
 */
export function findVolatile(sections) {
  /** @type {VolatileFinding[]} */
  const out = [];
  for (const s of sections) {
    if (s.scope !== "shared") continue;
    for (const raw of s.text.split(TOKEN_SPLIT)) {
      const tok = raw.replace(/[.:]+$/, "");
      const kind = classify(tok);
      if (kind === undefined) continue;
      out.push({ id: s.id, kind, sample: tok.slice(0, 12) + "…" });
      if (out.length >= MAX_FINDINGS) return out;
    }
  }
  return out;
}

/**
 * @param {{input_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number}} usage
 * @returns {number|undefined}
 */
export function cacheHitRatio(usage) {
  const read = usage.cache_read_input_tokens;
  const total = usage.input_tokens + read + usage.cache_creation_input_tokens;
  return total > 0 ? read / total : undefined;
}

/**
 * @param {number|undefined} prev
 * @param {number} hit
 * @returns {boolean}
 */
export function isCacheDrop(prev, hit) {
  return prev !== undefined && prev >= CACHE_DROP_THRESHOLD && hit < CACHE_DROP_THRESHOLD;
}

/**
 * A usage field as a persistable counter delta: a non-negative safe integer, else 0. One missing or
 * odd field (undefined, NaN, a fraction) must not poison the running totals, because the server
 * rejects every stats_put that carries such a row.
 * @param {unknown} n
 * @returns {number}
 */
export function toCount(n) {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/** @returns {Counters} all six counters at 0 */
export function zeroCounters() {
  return /** @type {Counters} */ (Object.fromEntries(COUNTER_KEYS.map((k) => [k, 0])));
}

/**
 * Local calendar day of an epoch-ms instant as YYYY-MM-DD.
 * @param {number} ms
 * @param {number} [offsetMin] minutes UTC minus local (Date#getTimezoneOffset); defaults to this runtime's offset at `ms`
 * @returns {string}
 */
export function dayKey(ms, offsetMin = new Date(ms).getTimezoneOffset()) {
  return new Date(ms - offsetMin * 60000).toISOString().slice(0, 10);
}

/**
 * First day of a rolling window of `days` calendar days ending with (and including) `day`.
 * Calendar arithmetic in UTC, so DST never shifts it.
 * @param {string} day YYYY-MM-DD
 * @param {number} days >= 1
 * @returns {string}
 */
export function windowStart(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The pane header's view name: "Session"; "Today (2026-10-03)"; "7 days (2026-09-27 – 2026-10-03)".
 * Without `today` an aggregate view reads as its label alone.
 * @param {View} view
 * @param {string} [today] YYYY-MM-DD
 * @returns {string}
 */
export function viewTitle(view, today) {
  const { label, days } = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  // days 0 first: windowStart(today, 0) would be tomorrow
  if (days === 0 || today === undefined) return label;
  if (days === 1) return `${label} (${today})`;
  return `${label} (${windowStart(today, days)} – ${today})`;
}

/**
 * Adds `pending` to `days[today]` (creating it), zeroes `pending` in place, drops every day outside
 * [purgeBefore, today], and returns each remaining day as a stats_put row (copies, so later folds
 * never change a queued write). Mutates `days` and `pending`.
 * @param {Record<string, Counters>} days
 * @param {Counters} pending
 * @param {string} today YYYY-MM-DD
 * @param {string} purgeBefore YYYY-MM-DD
 * @returns {(Counters & {day: string})[]}
 */
export function foldPending(days, pending, today, purgeBefore) {
  const total = (days[today] ??= zeroCounters());
  for (const k of COUNTER_KEYS) {
    total[k] += pending[k];
    pending[k] = 0; // in place: register.ts holds pending in a const
  }
  // Days after today go too, so a clock moved backwards never grows a stats_put past the window.
  for (const day of Object.keys(days)) if (day < purgeBefore || day > today) delete days[day];
  return Object.entries(days).map(([day, c]) => ({ day, ...c }));
}
