// Pure policy for inline-headroom. Never reference the mods `$` here: the
// engine's validation rejects passing the mods API into functions imported
// from another file. All `$` use lives inside hooks in register.ts. No clock
// reads either: time comes in as arguments.

/** @typedef {'low'|'medium'|'high'|'xhigh'|'max'} Effort */
/** @typedef {'uuid'|'iso8601'|'jwt'|'hex_hash'} VolatileKind */
/** @typedef {{id: string, kind: VolatileKind, sample: string}} VolatileFinding */
/** @typedef {{steps: number, clamped: number, cache_drops: number, input_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number}} Counters */
/** @typedef {Counters & {hit?: number}} Row hit: the ratio to show in place of the token-weighted one (the session row shows its last step's) */
/** @typedef {{ role: 'user'|'assistant', text: string, toolUses: readonly { input: Record<string, unknown> }[] }} QueryMessage the SessionMessage fields crushQuery reads */

export const EFFORT_ORDER = /** @type {const} */ (["low", "medium", "high", "xhigh", "max"]);
export const CACHE_DROP_THRESHOLD = 0.6;
export const MAX_FINDINGS = 10;
/** The /headroom table rows, top to bottom. `days`: the rolling window, today included; 0 = this session, in memory. */
export const ROWS = /** @type {const} */ ([
  { label: "session", days: 0 },
  { label: "today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
]);
/** Table column widths in cells: the row label, then each value column. */
export const CELL_WIDTHS = /** @type {const} */ ([16, 8, 8]);
/** Persisted days kept: the longest row's window, never less. */
export const RETAIN_DAYS = 30;
/** headroom_retrieve's full name: the tool.register op serves a mod tool as `mcp__<plugin>__<name>`. */
export const RETRIEVE_TOOL = "mcp__inline-headroom__headroom_retrieve";
/** A JSON document is crushed only above this many characters (upstream min_tokens_to_crush 200 × 4 chars per token: the mod has no tokenizer). */
export const CRUSH_MIN_CHARS = 800;
/** Offloaded originals kept for headroom_retrieve, oldest evicted first (upstream CCR DEFAULT_CAPACITY). */
export const CCR_CAPACITY = 1000;
/** Upstream ERROR_KEYWORDS: a row whose lowercased JSON holds one is never dropped. */
export const ERROR_KEYWORDS = /** @type {const} */ (["error", "exception", "failed", "failure", "critical", "fatal", "crash", "panic", "abort", "timeout", "denied", "rejected"]);

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
// SmartCrusher defaults: upstream SmartCrusherConfig::default() and compute_optimal_k's min_k.
const MAX_ITEMS_AFTER_CRUSH = 15;
const MIN_K = 3;
// CJK code point ranges (kana, ideographs, Hangul), as upstream's is_cjk_char.
const CJK_RANGES = [
  [0x3040, 0x30ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
];

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
 * The routing rule shared by the main loop and every subagent: a mechanical
 * step (after index 0, no tool error since the loop's last step) is clamped.
 * @param {number} index the step's index in its loop (0 = the ask step)
 * @param {boolean} errored a tool error since that loop's last step
 * @param {unknown} effort the step's current effort
 * @returns {Effort|undefined} the lowered effort, or undefined to leave it
 */
export function stepEffort(index, errored, effort) {
  return index > 0 && !errored ? clampEffort(effort) : undefined;
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
 * A ratio as a whole percentage, "–" when there is none.
 * @param {number|undefined} n
 * @returns {string}
 */
export function pct(n) {
  return n === undefined ? "–" : `${Math.round(n * 100)}%`;
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

/**
 * The /headroom tables as rows of cells. Each table starts with its header row (heading, then the column names), then one row per ROWS entry.
 * A row without counters (still loading, storage off or failing) shows `blank` in every value cell.
 * @param {readonly (Row|undefined)[]} counters one per ROWS entry, in ROWS order
 * @param {string} blank
 * @returns {string[][][]}
 */
export function statsTables(counters, blank) {
  /**
   * @param {string} heading
   * @param {string[]} columns
   * @param {(c: Row) => string[]} cells
   * @returns {string[][]}
   */
  const table = (heading, columns, cells) => [
    [heading, ...columns],
    ...ROWS.map((v, i) => {
      const c = counters[i];
      return [v.label, ...(c ? cells(c) : columns.map(() => blank))];
    }),
  ];
  return [
    table("effort routing", ["steps", "clamped"], (c) => [String(c.steps), String(c.clamped)]),
    table("cache aligner", ["hit", "drops"], (c) => [pct(c.hit ?? cacheHitRatio(c)), String(c.cache_drops)]),
  ];
}

/**
 * One table as plain text: the label column padded on the right, the value columns right-aligned.
 * @param {readonly (readonly string[])[]} rows
 * @returns {string}
 */
export function tableText(rows) {
  return rows.map((r) => r.map((s, i) => (i ? s.padStart(CELL_WIDTHS[i]) : s.padEnd(CELL_WIDTHS[i]))).join("")).join("\n");
}

// SmartCrusher: a port of headroom's dict-array lossy path (crates/headroom-core/src/transforms/smart_crusher).

/**
 * Two 32-bit lanes of a cyrb53-style hash over UTF-16 code units: the pure-JS stand-in for upstream's
 * MD5 (simhash grams) and SHA-256 (CCR hash), since a mods module is not known to load node:crypto.
 * @param {string} s
 * @returns {[number, number]} two unsigned 32-bit lanes
 */
function hash64(s) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0];
}

/**
 * @param {number} x a 32-bit integer
 * @returns {number} its set bits
 */
function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/**
 * Upstream simhash: every lowercased 4-code-point gram (the whole string when it has 3 or fewer) votes ±1 per hash bit.
 * @param {string} text
 * @returns {[number, number]} the 64-bit fingerprint as two 32-bit halves
 */
function simhash(text) {
  const cps = Array.from(text.toLowerCase());
  const votes = new Array(64).fill(0);
  const grams = cps.length <= 3 ? 1 : cps.length - 3;
  for (let i = 0; i < grams; i++) {
    const [a, b] = hash64(cps.slice(i, i + 4).join(""));
    for (let j = 0; j < 32; j++) {
      votes[j] += (a >>> j) & 1 ? 1 : -1;
      votes[j + 32] += (b >>> j) & 1 ? 1 : -1;
    }
  }
  let lo = 0;
  let hi = 0;
  for (let j = 0; j < 32; j++) {
    if (votes[j] > 0) lo |= 1 << j;
    if (votes[j + 32] > 0) hi |= 1 << j;
  }
  return [lo, hi];
}

/**
 * Upstream count_unique_simhash: greedy clusters of fingerprints within Hamming distance 3.
 * @param {readonly string[]} items
 * @returns {number}
 */
function countUniqueSimhash(items) {
  /** @type {[number, number][]} */
  const reps = [];
  for (const s of items) {
    const [lo, hi] = simhash(s);
    if (!reps.some(([a, b]) => popcount(lo ^ a) + popcount(hi ^ b) <= 3)) reps.push([lo, hi]);
  }
  return reps.length;
}

/**
 * Upstream compute_unique_bigram_curve: the running count of unique lowercased word bigrams
 * (a lone word pairs with "", a spaceless CJK word yields character bigrams, an empty item counts once).
 * @param {readonly string[]} items
 * @returns {number[]}
 */
function bigramCurve(items) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {readonly string[]} xs */
  const pairs = (xs) => {
    for (let j = 0; j < xs.length - 1; j++) seen.add(JSON.stringify([xs[j], xs[j + 1]]));
  };
  return items.map((item) => {
    const words = item.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length >= 2) pairs(words);
    else if (words.length === 1) {
      const cps = Array.from(words[0]);
      const cjk = cps.some((c) => {
        const x = c.codePointAt(0) ?? 0;
        return CJK_RANGES.some(([lo, hi]) => x >= lo && x <= hi);
      });
      if (cps.length >= 2 && cjk) pairs(cps);
      else seen.add(JSON.stringify([words[0], ""]));
    } else seen.add(JSON.stringify(["", ""]));
    return seen.size;
  });
}

/**
 * Upstream find_knee (Kneedle): 1 + the index farthest above the diagonal; undefined under 0.05 or below 3 points.
 * @param {readonly number[]} curve
 * @returns {number|undefined}
 */
function findKnee(curve) {
  const n = curve.length;
  if (n < 3) return undefined;
  const yMin = curve[0];
  const yRange = curve[n - 1] - yMin;
  if (Math.abs(yRange) < Number.EPSILON) return 1;
  let maxDiff = -1;
  let knee = 0;
  for (let i = 0; i < n; i++) {
    const diff = (curve[i] - yMin) / yRange - i / (n - 1);
    if (diff > maxDiff) {
      maxDiff = diff;
      knee = i;
    }
  }
  return maxDiff < 0.05 ? undefined : knee + 1;
}

/**
 * Upstream compute_optimal_k (bias 1, min_k 3, max_k 15): how many rows a dict array keeps, from simhash
 * diversity and the knee of its bigram coverage curve.
 * @param {readonly string[]} itemStrings each row's compact JSON
 * @returns {number}
 */
export function computeOptimalK(itemStrings) {
  const n = itemStrings.length;
  if (n <= 8) return n;
  const unique = countUniqueSimhash(itemStrings);
  if (unique <= 3) return Math.min(Math.max(MIN_K, unique), MAX_ITEMS_AFTER_CRUSH);
  const diversity = unique / n;
  const floor = Math.max(MIN_K, Math.floor(n * (0.3 + 0.7 * diversity)));
  let knee = findKnee(bigramCurve(itemStrings));
  if (knee === undefined) knee = floor;
  else if (diversity > 0.7) knee = Math.max(knee, floor);
  // shortcut: upstream's tier 3 (a zlib ratio check that can raise K by 20%) is skipped; add it once a node:zlib import is live-verified in a mods module.
  return Math.max(MIN_K, Math.min(Math.max(MIN_K, knee), MAX_ITEMS_AFTER_CRUSH));
}

/**
 * Stores offloaded originals for headroom_retrieve: a re-put moves its hash to the newest position, and the
 * oldest entries go once the store holds more than CCR_CAPACITY. Mutates `store`.
 * shortcut: no idle TTL (upstream: 30 min); add one with a time argument from register.ts if memory becomes a concern.
 * @param {Map<string, string>} store hash → original array JSON, oldest first
 * @param {readonly [string, string][]} entries
 * @returns {void}
 */
export function storeOffloaded(store, entries) {
  for (const [hash, json] of entries) {
    store.delete(hash);
    store.set(hash, json);
  }
  for (const hash of store.keys()) {
    if (store.size <= CCR_CAPACITY) break;
    store.delete(hash);
  }
}

/**
 * The crusher's query (upstream _extract_context_from_messages): newest first, the text of the last five
 * user messages (every user message counts, tool-result-only ones too) and each assistant tool call's input JSON.
 * @param {readonly QueryMessage[]} messages chronological, as the session.messages op returns them
 * @returns {string}
 */
export function crushQuery(messages) {
  /** @type {string[]} */
  const parts = [];
  let users = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      if (m.text) parts.push(m.text);
      if (++users >= 5) break;
    } else for (const u of m.toolUses) parts.push(JSON.stringify(u.input));
  }
  return parts.join(" ");
}
