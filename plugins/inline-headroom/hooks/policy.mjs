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
/**
 * A crushed document: compact text, rows lost, [hash, original text (a crushed array's JSON, an elided block, a folded span)] per crushed array.
 * @typedef {{ text: string, rowsDropped: number, offloaded: [string, string][] }} CrushOutcome
 */
/** @typedef {{ text: string, lines: number, offloaded: [string, string][] }} Elision a dense-line-elided text: the shortened text, the lines elided, [hash, original text] */
/**
 * One conversation's dedup corpus: the last ordinal handed out, each indexed block's verbatim lines (null where folded) by
 * ordinal, the anchor index (match key → [ordinal, line] first-seen, at most 16), and the indexed characters.
 * @typedef {{ turn: number, corpus: Map<number, (string|null)[]>, index: Map<string, [number, number][]>, chars: number }} DedupState
 */
/** @typedef {{ text: string, spans: number, offloaded: [string, string][] }} Fold a deduplicated text: the text with pointers, the runs folded, [hash, run text] per run */
/** @typedef {{ type: string } & Record<string, unknown>} ContentBlock one Messages-API content block, as session.append hands it */
/**
 * Which levers rewrite this row; dedup names the conversations map and this row's key ("" main, else agentId).
 * @typedef {{ crush: boolean, elide: boolean, dedup?: { states: Map<string, DedupState>, key: string } }} Levers
 */
/**
 * A rewritten tool-result row: its blocks, the originals for the CCR store, and each lever's savings.
 * @typedef {object} RowRewrite
 * @property {ContentBlock[]} content
 * @property {[string, string][]} offloaded
 * @property {{ dropped: number, saved: number }} crush
 * @property {{ lines: number, saved: number }} elide
 * @property {{ spans: number, saved: number }} dedup
 */
/**
 * One dict-array field (upstream FieldStats); the numeric statistics are absent when not finite.
 * @typedef {{ name: string, type: string, unique: number, ratio: number, min?: number, max?: number, mean?: number, variance?: number, changePoints: number[], avgLen?: number }} FieldStats
 */
/**
 * A dict array's analysis: fields sorted by name, the planner (or skip), and the rows no plan drops.
 * @typedef {{ fields: FieldStats[], strategy: 'skip'|'time_series'|'cluster'|'top_n'|'smart_sample', errors: number[], outliers: Set<number>, anomalies: Set<number> }} Analysis
 */
/**
 * One dict array's planning inputs: rows, their compact and sorted-key JSON, the analysis, the query and the row budget K.
 * @typedef {{ items: Record<string, unknown>[], strings: string[], canon: string[], analysis: Analysis, query: string, max: number }} CrushPlan
 */

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
/** The name register.ts registers the retrieval tool under. */
export const RETRIEVE_NAME = "headroom_retrieve";
/** This plugin's name, as `next.origin.plugin` reads it for the mod's own `$` calls. */
export const PLUGIN = "inline-headroom";
/** headroom_retrieve's full name: the tool.register op serves a mod tool as `mcp__<plugin>__<name>`. */
export const RETRIEVE_TOOL = `mcp__${PLUGIN}__${RETRIEVE_NAME}`;
/** A JSON document is crushed only above this many characters (upstream min_tokens_to_crush 200 × 4 chars per token: the mod has no tokenizer). */
export const CRUSH_MIN_CHARS = 800;
/** Offloaded originals kept for headroom_retrieve, oldest evicted first (upstream CCR DEFAULT_CAPACITY). */
export const CCR_CAPACITY = 1000;
/** Characters of offloaded originals kept in all (about 32 MB as UTF-16), oldest evicted first. Deviation: upstream caps by count only. */
export const CCR_MAX_CHARS = 16_000_000;
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
const MIN_ITEMS_TO_ANALYZE = 5;
const VARIANCE_THRESHOLD = 2.0;
const RELEVANCE_THRESHOLD = 0.3;
const MAX_PROCESS_DEPTH = 50;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// shortcut: Python int() also takes `_` digit separators; add them if a payload needs it.
const PY_INT_RE = /^\s*[+-]?\d+\s*$/;
// Anchor weights (front, middle, back) per planner, from upstream AnchorConfig::default(). The search pattern's
// weights are left out: the top_n planner selects no anchors.
const ANCHOR_WEIGHTS = {
  smart_sample: [0.5, 0.1, 0.4],
  cluster: [0.15, 1 - 0.15 - 0.75, 0.75],
  time_series: [0.45, 0.1, 0.45],
};
const RECENCY_WORDS = ["latest", "recent", "last", "newest", "current", "now"];
const HISTORICAL_WORDS = ["first", "oldest", "earliest", "original", "initial", "beginning"];
// Query anchors (upstream anchors.rs); JS \b is ASCII-only where Rust's is Unicode.
const ANCHOR_UUID_RE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const ANCHOR_NUMBER_RE = /\b\d{4,}\b/g;
const ANCHOR_HOST_RE = /\b[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z]{2,})?\b/g;
const ANCHOR_QUOTED_RE = /['"]([^'"]{1,50})['"]/g;
const ANCHOR_EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const BM25_TOKEN_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b\d{4,}\b|[a-z0-9_]+/g;
// The mod's own storage tools are never crushed: a kv_get → edit → kv_set would write the row loss back to storage.db.
const OWN_STORAGE_PREFIX = `mcp__plugin_${PLUGIN}_storage__`;
// Dense line elider: upstream dense_line_elider.py.
const DENSE_MIN_LINE_CHARS = 300;
const DENSE_MAX_SPACE_RATIO = 0.06;
const DENSE_MIN_TOTAL_CHARS = 2000;
const DENSE_HEAD_CHARS = 160;
const DENSE_TAIL_CHARS = 80;
// JSON span scan work budget: upstream recursive_json.py.
const SCAN_BUDGET_PER_CHAR = 4;
const SCAN_BUDGET_FLOOR = 4096;
// Cross-turn dedup: upstream cross_turn_dedup.py.
const DEDUP_MIN_LINES = 3;
const DEDUP_MIN_CHARS = 40;
const DEDUP_MAX_ANCHOR_CANDIDATES = 16;
const DEDUP_LINENO_RE = /^([1-9]\d*)(:|\t)([\s\S]*)$/;
const DEDUP_TRIVIAL = new Set(["return", "pass", "else:", "try:", "except:", "finally:", "break", "continue", "});", "})", "],", "),", '"""', "'''", "..."]);
// shortcut: about a 1M-token context at 4 chars per token; older content has left the model's window. Raise it if long sessions stop folding.
/** Indexed dedup characters kept across all conversations, least recently appended conversation dropped first. Deviation: upstream rebuilds per request and needs no cap. */
export const DEDUP_MAX_CHARS = 4_000_000;

/**
 * Whether a tool.check decides this mod's own storage call: `$.mcp.call` reaches core's permission step as a
 * `$.tool.call` (live on 2.1.296, although the typings promise no prompt), so without an allow rule a headless
 * session denies every `/headroom` write and an interactive one asks. The model's own storage calls are not covered.
 * @param {string} originPlugin `next.origin.plugin`
 * @param {string} tool
 * @returns {boolean}
 */
export function isOwnStorageCall(originPlugin, tool) {
  return originPlugin === PLUGIN && tool.startsWith(OWN_STORAGE_PREFIX);
}

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
 * A row without counters (still loading, storage off or failing) shows `blank` in every value cell. The in-memory session-only
 * counters add a `subagents` row under effort routing's session row, and the smart crusher, dedup and line elider tables, which have only a session row.
 * @param {readonly (Row|undefined)[]} counters one per ROWS entry, in ROWS order
 * @param {string} blank
 * @param {{ subagents?: { steps: number, clamped: number }, crush?: { dropped: number, saved: number }, dedup?: { spans: number, saved: number }, elide?: { lines: number, saved: number } }} [memory]
 * @returns {string[][][]} effort routing, cache aligner, smart crusher, dedup, line elider
 */
export function statsTables(counters, blank, memory = {}) {
  const { subagents, crush = { dropped: 0, saved: 0 }, dedup = { spans: 0, saved: 0 }, elide = { lines: 0, saved: 0 } } = memory;
  /**
   * @param {string} heading
   * @param {string[]} columns
   * @param {(c: Row) => string[]} cells
   * @param {string[][]} [underSession] rows right under the session row
   * @returns {string[][]}
   */
  const table = (heading, columns, cells, underSession = []) => [
    [heading, ...columns],
    ...ROWS.flatMap((v, i) => {
      const c = counters[i];
      const row = [v.label, ...(c ? cells(c) : columns.map(() => blank))];
      return v.days === 0 ? [row, ...underSession] : [row];
    }),
  ];
  const session = ROWS.find((v) => v.days === 0)?.label ?? "session";
  return [
    table("effort routing", ["steps", "clamped"], (c) => [String(c.steps), String(c.clamped)], subagents ? [["subagents", String(subagents.steps), String(subagents.clamped)]] : []),
    table("cache aligner", ["hit", "drops"], (c) => [pct(c.hit ?? cacheHitRatio(c)), String(c.cache_drops)]),
    [
      ["smart crusher", "dropped", "saved"],
      [session, String(crush.dropped), String(crush.saved)],
    ],
    [
      ["dedup", "spans", "saved"],
      [session, String(dedup.spans), String(dedup.saved)],
    ],
    [
      ["line elider", "lines", "saved"],
      [session, String(elide.lines), String(elide.saved)],
    ],
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
 * oldest entries go while the store holds more than CCR_CAPACITY entries or CCR_MAX_CHARS characters. Mutates `store`.
 * shortcut: no idle TTL (upstream: 30 min); add one with a time argument from register.ts if memory becomes a concern.
 * @param {Map<string, string>} store hash → original text (a crushed array's JSON, an elided block, a folded span), oldest first
 * @param {readonly [string, string][]} entries
 * @returns {void}
 */
export function storeOffloaded(store, entries) {
  for (const [hash, json] of entries) {
    store.delete(hash);
    store.set(hash, json);
  }
  let chars = 0;
  for (const json of store.values()) chars += json.length;
  for (const [hash, json] of store) {
    if (store.size <= CCR_CAPACITY && chars <= CCR_MAX_CHARS) break;
    store.delete(hash);
    chars -= json.length;
  }
}

/**
 * The crusher's query (upstream _extract_context_from_messages): newest first, the text of the last five
 * user messages with text and each assistant tool call's input JSON. Deviation: upstream counts every user message,
 * but a Claude Code tool result is a user message with empty text, so the real request would age out after five calls.
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
      if (!m.text) continue;
      parts.push(m.text);
      if (++users >= 5) break;
    } else for (const u of m.toolUses) parts.push(JSON.stringify(u.input));
  }
  return parts.join(" ");
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>} a JSON object (not an array, not null)
 */
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * An own property only: a row without `constructor` must not read Object.prototype's.
 * @param {Record<string, unknown>} o
 * @param {string} k
 * @returns {unknown}
 */
function own(o, k) {
  return Object.hasOwn(o, k) ? o[k] : undefined;
}

/**
 * Sorted-key compact JSON: the equality key upstream hashes (MD5 of sort_keys JSON) for dedup.
 * @param {unknown} v
 * @returns {string}
 */
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (isRecord(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/**
 * The 12-hex CCR hash of an original array's compact JSON (upstream: a SHA-256 prefix).
 * @param {string} s
 * @returns {string}
 */
function contentHash(s) {
  const [a, b] = hash64(s);
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 12);
}

/**
 * Python str() as upstream's analyzer counts distinct values: None/True/False, bare strings, JSON for containers.
 * @param {unknown} v
 * @returns {string}
 */
function pyStr(v) {
  if (v === null) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : JSON.stringify(v);
}

/**
 * Python repr as upstream's anchors.rs renders a row for query-anchor matching: single-quoted strings, ", " and ": ".
 * @param {unknown} v
 * @returns {string}
 */
function pythonRepr(v) {
  if (v === null) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "string") return `'${v}'`;
  if (Array.isArray(v)) return `[${v.map(pythonRepr).join(", ")}]`;
  if (isRecord(v))
    return `{${Object.keys(v)
      .map((k) => `'${k}': ${pythonRepr(v[k])}`)
      .join(", ")}}`;
  return String(v);
}

/**
 * Upstream stats_math::mean: undefined when empty or not finite.
 * @param {readonly number[]} xs
 * @returns {number|undefined}
 */
function mean(xs) {
  if (!xs.length) return undefined;
  let sum = 0;
  for (const x of xs) sum += x;
  const m = sum / xs.length;
  return Number.isFinite(m) ? m : undefined;
}

/**
 * Upstream sample_variance (n − 1): undefined below two values or when not finite.
 * @param {readonly number[]} xs
 * @returns {number|undefined}
 */
function sampleVariance(xs) {
  const m = xs.length < 2 ? undefined : mean(xs);
  if (m === undefined) return undefined;
  let sq = 0;
  for (const x of xs) sq += (x - m) * (x - m);
  const v = sq / (xs.length - 1);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Upstream detect_change_points (window 5): where the means of the 5 values before and after differ by more
 * than 2σ, each kept point more than 5 past the previous one.
 * @param {readonly number[]} xs
 * @returns {number[]} indices into `xs`
 */
function changePoints(xs) {
  const w = 5;
  const v = xs.length < 2 * w ? undefined : sampleVariance(xs);
  if (v === undefined || !(Math.sqrt(v) > 0)) return [];
  const threshold = VARIANCE_THRESHOLD * Math.sqrt(v);
  /** @type {number[]} */
  const out = [];
  for (let i = w; i < xs.length - w; i++) {
    const shift = Math.abs((mean(xs.slice(i, i + w)) ?? 0) - (mean(xs.slice(i - w, i)) ?? 0));
    if (shift > threshold && (!out.length || i - out[out.length - 1] > w)) out.push(i);
  }
  return out;
}

/**
 * Upstream analyze_field: type from the first non-null value, distinct values over all rows (a missing key is
 * null), numeric min/max/mean/variance/change points, and a string field's mean length in code points.
 * @param {string} name
 * @param {readonly Record<string, unknown>[]} items
 * @returns {FieldStats}
 */
function analyzeField(name, items) {
  const values = items.map((o) => own(o, name) ?? null);
  const nonNull = values.filter((v) => v !== null);
  /** @type {FieldStats} */
  const f = { name, type: "null", unique: 0, ratio: 0, changePoints: [] };
  if (!nonNull.length) return f;
  const first = nonNull[0];
  f.type = typeof first === "boolean" ? "boolean" : typeof first === "number" ? "numeric" : typeof first === "string" ? "string" : Array.isArray(first) ? "array" : "object";
  f.unique = new Set(values.map(pyStr)).size;
  f.ratio = f.unique / values.length;
  if (f.type === "numeric") {
    /** @type {number[]} */
    const nums = [];
    /** @type {number[]} */
    const rows = [];
    values.forEach((v, i) => {
      if (typeof v === "number" && Number.isFinite(v)) {
        nums.push(v);
        rows.push(i);
      }
    });
    let min = Infinity;
    let max = -Infinity;
    for (const x of nums) {
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    const m = mean(nums);
    const variance = nums.length > 1 ? sampleVariance(nums) : 0;
    // Upstream resets the whole numeric block when any statistic is not finite. Change points are mapped from
    // `nums` (nulls and non-numbers skipped) back to row indices, which the planners index by.
    if (m !== undefined && variance !== undefined && Number.isFinite(min) && Number.isFinite(max))
      Object.assign(f, { min, max, mean: m, variance, changePoints: changePoints(nums).map((k) => rows[k]) });
    else f.variance = 0;
  } else if (f.type === "string") {
    f.avgLen = mean(/** @type {string[]} */ (nonNull.filter((v) => typeof v === "string")).map((s) => Array.from(s).length));
  }
  return f;
}

/**
 * Upstream detect_sequential_pattern with check_order (both callers pass true): at least 5 numbers (one a real
 * JSON number, plain-integer strings count too) whose sorted gaps average 0.5..2 with over 80% in that range,
 * and over 70% of neighbours ascending in the original order.
 * @param {readonly unknown[]} values
 * @returns {boolean}
 */
function isSequential(values) {
  /** @type {number[]} */
  const nums = [];
  let real = false;
  for (const v of values) {
    if (typeof v === "number") {
      nums.push(v);
      real = true;
    } else if (typeof v === "string" && PY_INT_RE.test(v)) nums.push(Number(v));
  }
  if (nums.length < 5 || !real) return false;
  const sorted = [...nums].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((x, i) => x - sorted[i]);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (!(avg >= 0.5 && avg <= 2)) return false;
  if (!(gaps.filter((d) => d >= 0.5 && d <= 2).length / gaps.length > 0.8)) return false;
  return nums.slice(1).filter((x, i) => nums[i] <= x).length / (nums.length - 1) > 0.7;
}

/**
 * Upstream calculate_string_entropy: Shannon entropy over code points, normalized to 0..1.
 * @param {string} s
 * @returns {number}
 */
function stringEntropy(s) {
  const cps = Array.from(s);
  if (cps.length < 2) return 0;
  /** @type {Map<string, number>} */
  const freq = new Map();
  for (const c of cps) freq.set(c, (freq.get(c) ?? 0) + 1);
  let e = 0;
  for (const n of freq.values()) e -= (n / cps.length) * Math.log2(n / cps.length);
  const maxE = Math.log2(Math.min(freq.size, cps.length));
  return maxE > 0 ? e / maxE : 0;
}

/**
 * Upstream detect_id_field_statistically: the confidence that a field is a row id, 0 when it is not.
 * @param {FieldStats} f
 * @param {readonly unknown[]} values the field per row, a missing key as null
 * @returns {number}
 */
function idConfidence(f, values) {
  if (f.ratio < 0.9) return 0;
  if (f.type === "string") {
    const sample = /** @type {string[]} */ (values.slice(0, 20).filter((v) => typeof v === "string"));
    if (sample.length) {
      if (sample.filter((s) => UUID_RE.test(s)).length / sample.length > 0.8) return 0.95;
      if (sample.reduce((a, s) => a + stringEntropy(s), 0) / sample.length > 0.7 && f.ratio > 0.95) return 0.8;
    }
  }
  if (f.type === "numeric") {
    if (isSequential(values) && f.ratio > 0.95) return 0.9;
    if (f.min !== undefined && f.max !== undefined && f.max - f.min > 0 && f.ratio > 0.95) return 0.85;
  }
  return f.ratio > 0.98 ? 0.7 : 0;
}

/**
 * Upstream detect_score_field_statistically: the confidence (capped at 0.95) that a bounded, non-sequential
 * numeric field ranks the rows, 0 when it is not a score (below 0.4).
 * @param {FieldStats} f
 * @param {readonly Record<string, unknown>[]} items
 * @returns {number}
 */
function scoreConfidence(f, items) {
  if (f.type !== "numeric" || f.min === undefined || f.max === undefined) return 0;
  const { min, max } = f;
  let c;
  if (min >= 0 && min <= 1 && max >= 0 && max <= 1) c = 0.4;
  else if (min >= 0 && min <= 10 && max >= 0 && max <= 10) c = 0.3;
  else if (min >= 0 && min <= 100 && max >= 0 && max <= 100) c = 0.25;
  else if (min >= -1 && max <= 1) c = 0.35;
  else return 0;
  if (
    isSequential(
      items
        .slice(0, 50)
        .filter((o) => Object.hasOwn(o, f.name))
        .map((o) => o[f.name]),
    )
  )
    return 0;
  const nums = /** @type {number[]} */ (items.map((o) => own(o, f.name)).filter((v) => typeof v === "number" && Number.isFinite(v)));
  if (nums.length >= 5 && nums.slice(1).filter((x, i) => nums[i] >= x).length / (nums.length - 1) > 0.7) c += 0.3;
  const first = nums.slice(0, 20);
  if (first.length && first.filter((x) => x !== Math.trunc(x)).length > first.length * 0.3) c += 0.1;
  return c >= 0.4 ? Math.min(c, 0.95) : 0;
}

/**
 * Upstream detect_temporal_field: a string field mostly ISO dates in its first 10 rows, or a numeric field whose
 * minimum looks like epoch seconds or milliseconds.
 * @param {readonly FieldStats[]} fields
 * @param {readonly Record<string, unknown>[]} items
 * @returns {boolean}
 */
function hasTemporalField(fields, items) {
  for (const f of fields) {
    if (f.type === "string") {
      const sample = /** @type {string[]} */ (
        items
          .slice(0, 10)
          .map((o) => own(o, f.name))
          .filter((v) => typeof v === "string")
      );
      if (sample.length && sample.filter((s) => ISO_DATETIME_RE.test(s) || ISO_DATE_RE.test(s)).length / sample.length > 0.5) return true;
    } else if (f.type === "numeric" && f.min !== undefined && ((f.min >= 1e9 && f.min <= 2e9) || (f.min >= 1e12 && f.min <= 2e12))) return true;
  }
  return false;
}

/**
 * Upstream detect_pattern: time_series, logs, search_results or generic.
 * @param {readonly FieldStats[]} fields
 * @param {readonly Record<string, unknown>[]} items
 * @returns {'time_series'|'logs'|'search_results'|'generic'}
 */
function detectPattern(fields, items) {
  if (fields.some((f) => f.type === "numeric" && (f.variance ?? 0) > 0) && hasTemporalField(fields, items)) return "time_series";
  let message = false;
  let level = false;
  for (const f of fields) {
    if (f.type !== "string") continue;
    if (f.ratio > 0.5 && (f.avgLen ?? 0) > 20) message = true;
    else if (f.ratio < 0.1 && f.unique >= 2 && f.unique <= 10) level = true;
  }
  if (message && level) return "logs";
  return fields.some((f) => scoreConfidence(f, items) >= 0.5) ? "search_results" : "generic";
}

/**
 * Upstream detect_rare_status_values for one common field: with 2..50 distinct non-null values, the fewest most
 * frequent values covering 80% of the rows that hold the key; if at most 5 do, the rows holding any other value.
 * @param {readonly Record<string, unknown>[]} items
 * @param {string} name
 * @returns {number[]}
 */
function rareStatusRows(items, name) {
  /** @param {unknown} v */
  const key = (v) => (v === null ? "__none__" : typeof v === "string" ? v : JSON.stringify(v));
  const values = items.filter((o) => Object.hasOwn(o, name)).map((o) => o[name]);
  const distinct = new Set(values.filter((v) => v !== null).map(key)).size;
  if (distinct < 2 || distinct > 50) return [];
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const v of values) counts.set(key(v), (counts.get(key(v)) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const need = Math.ceil(values.length * 0.8);
  const top = new Set();
  let covered = 0;
  for (const [v, c] of ranked) {
    covered += c;
    top.add(v);
    if (covered >= need) break;
  }
  if (top.size > 5) return [];
  return items.flatMap((o, i) => (Object.hasOwn(o, name) && !top.has(key(o[name])) ? [i] : []));
}

/**
 * Upstream detect_structural_outliers (5+ rows): rows holding a key present in under 20% of the rows, and rows
 * with a rare value in a key present in at least 80% of them.
 * @param {readonly Record<string, unknown>[]} items
 * @returns {Set<number>}
 */
function structuralOutliers(items) {
  const n = items.length;
  /** @type {Set<number>} */
  const out = new Set();
  if (n < 5) return out;
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const o of items) for (const k of Object.keys(o)) counts.set(k, (counts.get(k) ?? 0) + 1);
  const rare = new Set([...counts].filter(([, c]) => c < n * 0.2).map(([k]) => k));
  items.forEach((o, i) => {
    if (Object.keys(o).some((k) => rare.has(k))) out.add(i);
  });
  const common = [...counts].filter(([, c]) => c >= n * 0.8).map(([k]) => k);
  for (const k of common.sort()) for (const i of rareStatusRows(items, k)) out.add(i);
  return out;
}

/**
 * Upstream numeric anomalies: rows more than 2σ from a numeric field's mean (fields with variance > 0).
 * @param {readonly FieldStats[]} fields
 * @param {readonly Record<string, unknown>[]} items
 * @returns {Set<number>}
 */
function anomalyRows(fields, items) {
  /** @type {Set<number>} */
  const out = new Set();
  for (const f of fields) {
    const m = f.mean;
    if (f.type !== "numeric" || m === undefined || !((f.variance ?? 0) > 0)) continue;
    const threshold = VARIANCE_THRESHOLD * Math.sqrt(f.variance ?? 0);
    items.forEach((o, i) => {
      const x = own(o, f.name);
      if (typeof x === "number" && Math.abs(x - m) > threshold) out.add(i);
    });
  }
  return out;
}

/**
 * Upstream analyze_array: field stats, the crushability gate (analyze_crushability) and the strategy
 * (select_strategy). Errors, structural outliers and anomalies are kept for the planners, which recompute the same sets upstream.
 * @param {readonly Record<string, unknown>[]} items
 * @param {readonly string[]} strings each row's compact JSON
 * @returns {Analysis}
 */
function analyzeArray(items, strings) {
  const fields = [...new Set(items.flatMap((o) => Object.keys(o)))].sort().map((k) => analyzeField(k, items));
  const pattern = detectPattern(fields, items);
  const errors = strings.flatMap((s, i) => {
    const l = s.toLowerCase();
    return ERROR_KEYWORDS.some((k) => l.includes(k)) ? [i] : [];
  });
  const outliers = structuralOutliers(items);
  const anomalies = anomalyRows(fields, items);
  const hasChangePoints = fields.some((f) => f.changePoints.length > 0);
  // The best id field (strict >), whatever its confidence; has_id needs 0.7.
  /** @type {string|undefined} */
  let idName;
  let idRatio = 0;
  let idConf = 0;
  for (const f of fields) {
    const c = idConfidence(
      f,
      items.map((o) => own(o, f.name) ?? null),
    );
    if (c > idConf) [idName, idRatio, idConf] = [f.name, f.ratio, c];
  }
  const hasId = idName !== undefined && idConf >= 0.7;
  const signal = fields.some((f) => scoreConfidence(f, items) > 0) || outliers.size > 0 || errors.length > 0 || anomalies.size > 0 || hasChangePoints;
  /** @param {string} type */
  const avgRatio = (type) => mean(fields.filter((f) => f.type === type && f.name !== idName).map((f) => f.ratio)) ?? 0;
  const stringU = avgRatio("string");
  const maxU = Math.max(stringU, idRatio, 0);
  const contentU = Math.max(stringU, avgRatio("numeric"));
  // Upstream's ladder: repetitive content with ids, then low uniqueness, crush; every later case
  // (unique_entities_no_signal, unique_entities_with_signal, medium_uniqueness_*) crushes exactly when a signal is present.
  const crushable = (contentU < 0.1 && hasId) || maxU < 0.3 || signal;
  /** @type {Analysis['strategy']} */
  let strategy = "smart_sample";
  if (!crushable) strategy = "skip";
  else if (pattern === "time_series" && hasChangePoints) strategy = "time_series";
  else if (pattern === "logs" && (fields.find((f) => f.name.toLowerCase().includes("message"))?.ratio ?? 1) < 0.5) strategy = "cluster";
  else if (pattern === "search_results") strategy = "top_n";
  return { fields, strategy, errors, outliers, anomalies };
}

/**
 * Upstream calculate_information_score over a region: 0.4 value rareness + 0.3 relative length + 0.3 structural
 * uniqueness (holding rare keys, missing common ones), clamped to 0..1.
 * @param {Record<string, unknown>} item
 * @param {readonly Record<string, unknown>[]} region
 * @returns {number}
 */
function informationScore(item, region) {
  const n = region.length;
  if (n < 2) return 0.5; // every factor is 0.5 for a one-row region
  /** @param {unknown} v */
  const valueKey = (v) => (typeof v === "string" ? v : canonicalJson(v));
  /** @type {Map<string, Map<string, number>>} */
  const values = new Map();
  /** @type {Map<string, number>} */
  const keys = new Map();
  let minLen = Infinity;
  let maxLen = -Infinity;
  for (const o of region) {
    for (const k of Object.keys(o)) {
      const counts = values.get(k) ?? new Map();
      values.set(k, counts);
      counts.set(valueKey(o[k]), (counts.get(valueKey(o[k])) ?? 0) + 1);
      keys.set(k, (keys.get(k) ?? 0) + 1);
    }
    const len = JSON.stringify(o).length;
    minLen = Math.min(minLen, len);
    maxLen = Math.max(maxLen, len);
  }
  const rareness = Object.keys(item).flatMap((k) => {
    const c = values.get(k)?.get(valueKey(item[k])) ?? 0;
    return c > 0 ? [1 - c / n] : [];
  });
  const uniqueness = rareness.length ? rareness.reduce((a, b) => a + b, 0) / rareness.length : 0.5;
  const length = maxLen === minLen ? 0.5 : (JSON.stringify(item).length - minLen) / (maxLen - minLen);
  const itemKeys = new Set(Object.keys(item));
  const common = [...keys].filter(([, c]) => c >= n * 0.8).map(([k]) => k);
  const rare = [...keys].filter(([, c]) => c < n * 0.2).map(([k]) => k);
  let structural = 0;
  if (rare.length) structural += 0.5 * (rare.filter((k) => itemKeys.has(k)).length / rare.length);
  if (common.length) structural += 0.5 * (common.filter((k) => !itemKeys.has(k)).length / common.length);
  return Math.min(1, Math.max(0, uniqueness * 0.4 + length * 0.3 + Math.min(structural, 1) * 0.3));
}

/**
 * Upstream AnchorSelector::select_anchors for an array longer than K: position anchors (25% of K, 3..12 slots)
 * split over the front, middle and back by the planner's weights, shifted by recency or history words in the
 * query; the middle picks by information density, and rows with the same content are taken once.
 * @param {CrushPlan} p
 * @param {'smart_sample'|'cluster'|'time_series'} planner
 * @returns {number[]}
 */
function selectAnchors(p, planner) {
  const { items, canon, max, query } = p;
  const n = items.length;
  const budget = Math.min(Math.min(12, Math.max(3, Math.floor(max * 0.25))), n);
  /** @type {(f: number, m: number, b: number) => [number, number, number]} */
  const normalize = (f, m, b) => [f / (f + m + b), m / (f + m + b), b / (f + m + b)];
  let [front, middle, back] = ANCHOR_WEIGHTS[planner];
  const q = query.toLowerCase();
  const recent = RECENCY_WORDS.some((w) => q.includes(w));
  const historical = HISTORICAL_WORDS.some((w) => q.includes(w));
  if (recent !== historical) {
    if (recent) [front, back] = [Math.max(0.1, front - 0.15), Math.min(0.8, back + 0.15)];
    else [front, back] = [Math.min(0.8, front + 0.15), Math.max(0.1, back - 0.15)];
    [front, middle, back] = normalize(front, middle, back);
  }
  const [frontW, , backW] = normalize(front, middle, back); // upstream normalizes a shifted set twice
  const frontSlots = Math.max(1, Math.floor(budget * frontW));
  let backSlots = Math.max(1, Math.floor(budget * backW));
  let middleSlots = Math.max(0, budget - (frontSlots + backSlots));
  // Over budget: the middle gives way first, then the back (down to 1).
  const excess = frontSlots + middleSlots + backSlots - budget;
  if (excess > 0) {
    const cut = Math.min(middleSlots, excess);
    middleSlots -= cut;
    if (excess > cut) backSlots = Math.max(1, backSlots - (excess - cut));
  }
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {(start: number, end: number, slots: number) => number[]} evenly spaced picks; a duplicate tries +1, −1, +2, −2 */
  const region = (start, end, slots) => {
    /** @type {number[]} */
    const picked = [];
    const size = end - start;
    if (slots === 0 || size <= 0) return picked;
    /** @param {number} i */
    const take = (i) => {
      if (seen.has(canon[i])) return false;
      seen.add(canon[i]);
      picked.push(i);
      return true;
    };
    const step = size / (slots + 1);
    if (slots >= size) for (let i = start; i < end; i++) take(i);
    else
      for (let k = 0; k < slots; k++) {
        const i = Math.min(start + Math.floor((k + 1) * step), end - 1);
        if (!take(i)) for (const off of [1, -1, 2, -2]) if (i + off >= start && i + off < end && take(i + off)) break;
      }
    return picked;
  };
  const frontPicks = region(0, Math.min(frontSlots * 2, Math.floor(n / 3)), frontSlots);
  const backPicks = region(Math.max(n - backSlots * 2, Math.floor((2 * n) / 3)), n, backSlots);
  /** @type {number[]} */
  const middlePicks = [];
  const start = frontPicks.length;
  const end = n - backPicks.length;
  if (middleSlots > 0 && end > start) {
    const size = end - start;
    const count = Math.min(middleSlots * 3, size);
    const step = size / (count + 1);
    const area = items.slice(start, end);
    /** @type {[number, number][]} */
    const candidates = [];
    for (let k = 0; k < count; k++) {
      const i = Math.min(start + Math.floor((k + 1) * step), end - 1);
      if (!seen.has(canon[i])) candidates.push([i, informationScore(items[i], area)]);
    }
    candidates.sort((a, b) => b[1] - a[1]); // stable: equal scores keep index order
    for (const [i] of candidates.slice(0, middleSlots))
      if (!seen.has(canon[i])) {
        seen.add(canon[i]);
        middlePicks.push(i);
      }
  }
  return [...frontPicks, ...backPicks, ...middlePicks];
}

/**
 * Upstream extract_query_anchors: UUIDs, 4+ digit numbers, host names, short quoted strings and emails, lowercased.
 * @param {string} text
 * @returns {Set<string>}
 */
function queryAnchors(text) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of text.matchAll(ANCHOR_UUID_RE)) out.add(m[0].toLowerCase());
  for (const m of text.matchAll(ANCHOR_NUMBER_RE)) out.add(m[0]);
  for (const m of text.matchAll(ANCHOR_HOST_RE)) if (!["e.g", "i.e", "etc."].includes(m[0].toLowerCase())) out.add(m[0].toLowerCase());
  for (const m of text.matchAll(ANCHOR_QUOTED_RE)) if (m[1].trim().length >= 2) out.add(m[1].toLowerCase());
  for (const m of text.matchAll(ANCHOR_EMAIL_RE)) out.add(m[0].toLowerCase());
  return out;
}

/**
 * Whether a term found in `hits` of `n` rows singles rows out. Deviation: upstream counts any match, so a term in
 * every row (a key name, a shared host) marks every row relevant and the crush degrades to the head rows; here,
 * as where classic BM25's idf turns non-positive, a term in more than half the rows is ignored.
 * @param {number} hits
 * @param {number} n
 * @returns {boolean}
 */
const isSelective = (hits, n) => hits * 2 <= n;

/**
 * Upstream item_matches_anchors: rows whose lowercased Python repr contains a selective query anchor.
 * @param {readonly Record<string, unknown>[]} items
 * @param {string} query
 * @returns {number[]}
 */
function anchorRows(items, query) {
  const anchors = [...queryAnchors(query)];
  if (!anchors.length) return [];
  const hits = items.map((o) => {
    const repr = pythonRepr(o).toLowerCase();
    return anchors.filter((a) => repr.includes(a));
  });
  const selective = new Set(anchors.filter((a) => isSelective(hits.filter((h) => h.includes(a)).length, items.length)));
  return hits.flatMap((h, i) => (h.some((a) => selective.has(a)) ? [i] : []));
}

/**
 * Upstream HybridScorer::score_batch without embeddings (BM25 k1 1.5, b 0.75, ln 2 idf, normalized by 10, +0.3 for a
 * matched token of 8+ chars), then the BM25-only boost: a match scores at least 0.3, two or more add 0.2. Only
 * selective query tokens (isSelective) count as matches.
 * @param {readonly string[]} docs each row's compact JSON
 * @param {string} query
 * @returns {number[]} one score per row, 0..1
 */
function relevanceScores(docs, query) {
  /** @param {string} s @returns {string[]} */
  const tokens = (s) => s.toLowerCase().match(BM25_TOKEN_RE) ?? [];
  /** @type {Map<string, number>} */
  const qf = new Map();
  for (const t of tokens(query)) qf.set(t, (qf.get(t) ?? 0) + 1);
  if (!qf.size) return docs.map(() => 0);
  const all = docs.map(tokens);
  const terms = [...qf.keys()].sort().filter((t) => isSelective(all.filter((d) => d.includes(t)).length, docs.length));
  const avg = all.reduce((a, d) => a + d.length, 0) / Math.max(docs.length, 1);
  return all.map((doc) => {
    if (!doc.length) return 0;
    /** @type {Map<string, number>} */
    const tf = new Map();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
    const matched = terms.filter((t) => tf.has(t));
    let raw = 0;
    for (const t of matched) {
      const f = tf.get(t) ?? 0;
      raw += ((Math.LN2 * (f * 2.5)) / (f + 1.5 * (1 - 0.75 + (0.75 * doc.length) / (avg > 0 ? avg : doc.length)))) * (qf.get(t) ?? 0);
    }
    let score = Math.min(raw / 10, 1);
    if (matched.some((t) => t.length >= 8)) score = Math.min(score + 0.3, 1);
    if (matched.length) score = Math.max(score, 0.3);
    if (matched.length >= 2) score = Math.min(score + 0.2, 1);
    return score;
  });
}

/**
 * Upstream apply_query_signals: rows matching a query anchor (in their Python repr) or scoring relevance >= 0.3.
 * @param {CrushPlan} p
 * @param {Set<number>} keep mutated
 * @returns {void}
 */
function addQuerySignals(p, keep) {
  if (!p.query) return;
  for (const i of anchorRows(p.items, p.query)) keep.add(i);
  relevanceScores(p.strings, p.query).forEach((s, i) => {
    if (s >= RELEVANCE_THRESHOLD) keep.add(i);
  });
}

/**
 * Upstream prioritize_indices: one row per content (the lowest index), topped up to K by an interleaved stride over
 * the rest; over K, errors, structural outliers and anomalies stay whatever the budget, then the first 3 and last 2
 * rows and the remaining picks in index order fill what is left.
 * @param {CrushPlan} p
 * @param {Set<number>} keep
 * @returns {Set<number>}
 */
function prioritize(p, keep) {
  const { canon, analysis: a, max } = p;
  const n = canon.length;
  /** @type {Map<string, number>} */
  const firstByContent = new Map();
  for (const i of [...keep].sort((x, y) => x - y)) if (!firstByContent.has(canon[i])) firstByContent.set(canon[i], i);
  const current = new Set(firstByContent.values());
  if (current.size < max && current.size < n) {
    const remaining = max - current.size;
    const seen = new Set(firstByContent.keys());
    /** @type {number[]} */
    const candidates = [];
    for (let i = 0; i < n; i++) if (!current.has(i)) candidates.push(i);
    const step = Math.max(1, Math.floor(candidates.length / (remaining + 1)));
    let added = 0;
    for (let s = 0; s < step && added < remaining; s++)
      for (let j = s; j < candidates.length && added < remaining; j += step) {
        const i = candidates[j];
        if (seen.has(canon[i])) continue;
        seen.add(canon[i]);
        current.add(i);
        added++;
      }
  }
  if (current.size <= max) return current;
  const out = new Set([...a.errors, ...a.outliers, ...a.anomalies]);
  let room = Math.max(0, max - out.size);
  /** @param {number} i */
  const fill = (i) => {
    if (room > 0 && !out.has(i)) {
      out.add(i);
      room--;
    }
  };
  for (let i = 0; i < Math.min(3, n); i++) fill(i);
  for (let i = Math.max(0, n - 2); i < n; i++) fill(i);
  for (const i of [...current].sort((x, y) => x - y)) fill(i);
  return out;
}

/**
 * Upstream create_plan and its four planners, as the set of row indices to keep.
 * @param {CrushPlan} p
 * @returns {Set<number>}
 */
function createPlan(p) {
  const { items, analysis: a, max, query } = p;
  const n = items.length;
  /** @type {Set<number>} */
  const keep = new Set();
  /** @param {Iterable<number>} xs */
  const add = (xs) => {
    for (const i of xs) keep.add(i);
  };
  if (a.strategy === "top_n") {
    // The highest-confidence score field (strict >); a top_n strategy implies one.
    let field = "";
    let best = 0;
    for (const f of a.fields) {
      const c = scoreConfidence(f, items);
      if (c > best) [field, best] = [f.name, c];
    }
    /** @param {Record<string, unknown>} o */
    const score = (o) => {
      const v = own(o, field);
      return typeof v === "number" ? v : 0;
    };
    add(
      items
        .map((o, i) => /** @type {[number, number]} */ ([i, score(o)]))
        .sort((x, y) => y[1] - x[1])
        .slice(0, Math.max(max - 3, 0))
        .map(([i]) => i),
    );
    add(a.errors);
    add(a.outliers);
    if (query) {
      add(anchorRows(items, query));
      // At most 3 more rows, and only high-confidence ones.
      const scores = relevanceScores(p.strings, query);
      let added = 0;
      for (let i = 0; i < n && added < 3; i++)
        if (!keep.has(i) && scores[i] >= Math.max(RELEVANCE_THRESHOLD * 2, 0.5)) {
          keep.add(i);
          added++;
        }
    }
    return keep; // no prioritization: top_n may keep more than K, as upstream
  }
  add(selectAnchors(p, a.strategy === "time_series" || a.strategy === "cluster" ? a.strategy : "smart_sample"));
  add(a.errors);
  add(a.outliers);
  /** @param {number} w */
  const aroundChangePoints = (w) => {
    for (const f of a.fields) for (const cp of f.changePoints) for (let i = Math.max(0, cp - w); i <= Math.min(n - 1, cp + w); i++) keep.add(i);
  };
  if (a.strategy === "time_series") aroundChangePoints(2);
  else if (a.strategy === "cluster") {
    // Cluster on the string field with the highest uniqueness above 0.3 (strict >), two rows per 50-code-point prefix.
    let field = "";
    let best = 0;
    for (const f of a.fields) if (f.type === "string" && f.ratio > best && f.ratio > 0.3) [field, best] = [f.name, f.ratio];
    if (best > 0) {
      /** @type {Map<string, number>} */
      const taken = new Map();
      items.forEach((o, i) => {
        const v = own(o, field);
        const prefix = Array.from(typeof v === "string" ? v : "")
          .slice(0, 50)
          .join("");
        const c = taken.get(prefix) ?? 0;
        if (c < 2) {
          taken.set(prefix, c + 1);
          keep.add(i);
        }
      });
    }
  } else {
    add(a.anomalies);
    aroundChangePoints(1);
  }
  addQuerySignals(p, keep);
  return prioritize(p, keep);
}

/**
 * Upstream crush_array_with_source without compaction: undefined when the array is within K (the caller recurses
 * into its rows); the array itself when the crushability gate skips it; else the kept rows in index order.
 * @param {Record<string, unknown>[]} items
 * @param {string} query
 * @returns {Record<string, unknown>[]|undefined}
 */
function crushDictArray(items, query) {
  const strings = items.map((o) => JSON.stringify(o));
  const max = computeOptimalK(strings);
  if (items.length <= max) return undefined;
  const analysis = analyzeArray(items, strings);
  if (analysis.strategy === "skip") return items;
  const keep = createPlan({ items, strings, canon: items.map(canonicalJson), analysis, query, max });
  return [...keep].sort((a, b) => a - b).map((i) => items[i]);
}

/**
 * A number lexeme as sign, significant digits and a power of ten, so two spellings of one decimal compare equal.
 * @param {string} lexeme
 * @returns {string|undefined} undefined when it is not a decimal ("Infinity")
 */
function canonNumber(lexeme) {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(lexeme);
  if (!m) return undefined;
  const frac = m[3] ?? "";
  const digits = (m[2] + frac).replace(/^0+/, "");
  const sig = digits.replace(/0+$/, "");
  return sig === "" ? "0" : `${m[1]}${sig}e${Number(m[4] ?? 0) - frac.length + digits.length - sig.length}`;
}

/**
 * @param {unknown} v
 * @returns {number} the object keys at every depth of `v`
 */
function countKeys(v) {
  const children = Array.isArray(v) ? v : isRecord(v) ? Object.values(v) : [];
  let n = isRecord(v) ? Object.keys(v).length : 0;
  for (const c of children) n += countKeys(c);
  return n;
}

/**
 * True when JSON.stringify(value) would not say what `text` says: a number whose double prints as another decimal
 * (more than 17 significant digits, an integer past 2^53, an overflow to Infinity), a -0, or a duplicate object key.
 * @param {string} text valid JSON
 * @param {unknown} value JSON.parse(text)
 * @returns {boolean}
 */
function isLossy(text, value) {
  let keys = 0; // key tokens in the text: more than the parsed objects hold means a later duplicate won
  const token = /"[^"\\]*(?:\\.[^"\\]*)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const colon = /\s*:/y;
  for (let m = token.exec(text); m !== null; m = token.exec(text)) {
    const lexeme = m[0];
    if (lexeme[0] === '"') {
      colon.lastIndex = token.lastIndex;
      if (colon.test(text)) keys++;
    } else {
      if (lexeme[0] === "-" && Number(lexeme) === 0) return true;
      // Up to 15 characters without an exponent hold at most 15 digits, which survive the decimal -> double -> decimal trip.
      if ((lexeme.length > 15 || /e/i.test(lexeme)) && canonNumber(lexeme) !== canonNumber(String(Number(lexeme)))) return true;
    }
  }
  return keys !== countKeys(value);
}

/**
 * Upstream process_value: crushes each dict array of 5+ rows (a CCR sentinel closes one that lost rows, and its
 * kept rows are not descended into), recurses into everything else, keeps every object key, and parses
 * stringified JSON containers (process_string). Depth 50 and below is left as is.
 * @param {unknown} v
 * @param {number} depth
 * @param {string} query
 * @param {{ rowsDropped: number, offloaded: [string, string][] }} acc rows dropped and originals, mutated
 * @returns {unknown} `v` itself when nothing below it changed
 */
function processValue(v, depth, query, acc) {
  if (depth >= MAX_PROCESS_DEPTH) return v;
  if (typeof v === "string") {
    // A stringified JSON object or array is crushed too and re-emitted as a string (opaque-blob CCR is deferred).
    if (!/^[{[]/.test(v.trimStart())) return v;
    let parsed;
    try {
      parsed = JSON.parse(v);
    } catch {
      return v;
    }
    if (typeof parsed !== "object" || parsed === null || isLossy(v, parsed)) return v;
    const out = processValue(parsed, depth + 1, query, acc);
    return out === parsed ? v : JSON.stringify(out);
  }
  if (Array.isArray(v)) {
    // Only dict arrays are crushed: the string, number and mixed crushers are deferred, so those arrays keep every element.
    const kept = v.length >= MIN_ITEMS_TO_ANALYZE && v.every(isRecord) ? crushDictArray(v, query) : undefined;
    if (kept === undefined) {
      const out = v.map((x) => processValue(x, depth + 1, query, acc));
      return out.some((x, i) => x !== v[i]) ? out : v;
    }
    if (kept.length === v.length) return v;
    const json = JSON.stringify(v);
    const hash = contentHash(json);
    const dropped = v.length - kept.length;
    acc.rowsDropped += dropped;
    acc.offloaded.push([hash, json]);
    return [...kept, { _ccr_dropped: `<<ccr:${hash} ${dropped}_rows_offloaded>>` }];
  }
  if (!isRecord(v)) return v;
  const entries = Object.entries(v).map(([k, x]) => /** @type {[string, unknown]} */ ([k, processValue(x, depth + 1, query, acc)]));
  // fromEntries defines own properties, so a "__proto__" key stays data.
  return entries.some(([k, x]) => x !== v[k]) ? Object.fromEntries(entries) : v;
}

/**
 * SmartCrusher over one JSON document (upstream smart_crush_content without compaction): dict arrays lose rows
 * to a `{"_ccr_dropped":"<<ccr:HASH N_rows_offloaded>>"}` sentinel and the result is compact JSON. Undefined means
 * pass the text through: at most CRUSH_MIN_CHARS, not a JSON object or array, a number, -0 or duplicate key JSON.parse
 * cannot keep, no row dropped, or output that is not shorter. Deviation: upstream also minifies a pretty-printed
 * document that lost no rows; here such a result keeps its original bytes.
 * @param {string} text
 * @param {string} query the conversation context (crushQuery), "" for none
 * @returns {CrushOutcome|undefined}
 */
export function crushJson(text, query) {
  if (text.length <= CRUSH_MIN_CHARS) return undefined;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || isLossy(text, value)) return undefined;
  /** @type {{ rowsDropped: number, offloaded: [string, string][] }} */
  const acc = { rowsDropped: 0, offloaded: [] };
  const out = processValue(value, 0, query, acc);
  if (out === value) return undefined; // nothing dropped: keep the original bytes
  const s = JSON.stringify(out);
  return s.length < text.trim().length ? { text: s, ...acc } : undefined;
}

/**
 * A candidate parses, so a build log that starts with "[" never costs the hook a transcript fetch.
 * @param {string} s
 * @returns {boolean} more than CRUSH_MIN_CHARS and a JSON object or array
 */
function looksLikeJsonDoc(s) {
  if (s.length <= CRUSH_MIN_CHARS || !/^[{[]/.test(s.trimStart())) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {unknown} b
 * @returns {b is { type: "text", text: string }} a text content block (an MCP result's or a Messages-API tool_result's)
 */
function isTextBlock(b) {
  return isRecord(b) && b.type === "text" && typeof b.text === "string";
}

// Dense line elider: a port of headroom's dense_line_elider.py and ContentRouter._elide_dense.

/**
 * A cut at `i` would split a surrogate pair: a low surrogate at `i` preceded by a high one.
 * @param {string} s
 * @param {number} i
 * @returns {boolean}
 */
function splitsPair(s, i) {
  if (i <= 0 || i >= s.length) return false;
  const lo = s.charCodeAt(i);
  const hi = s.charCodeAt(i - 1);
  return lo >= 0xdc00 && lo <= 0xdfff && hi >= 0xd800 && hi <= 0xdbff;
}

/**
 * The end of a head cut `s.slice(0, i)` that leaves no lone surrogate (one unit shorter when `i` splits a pair).
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function pairSafeEnd(s, i) {
  return splitsPair(s, i) ? i - 1 : i;
}

/**
 * The start of a tail cut `s.slice(i)` that leaves no lone surrogate (one unit later when `i` splits a pair).
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function pairSafeStart(s, i) {
  return splitsPair(s, i) ? i + 1 : i;
}

/**
 * Upstream _scan_from: walks one bracket span from `start` outside strings, records every container it pushed
 * in `known` (its end, or null when it never closes) and returns the span's end (or null) and the characters walked.
 * @param {string} text
 * @param {number} start the index of a "[" or "{"
 * @param {Map<number, number|null>} known
 * @returns {[number|null, number]}
 */
function scanFrom(text, start, known) {
  /** @type {number[]} */
  const stack = [];
  let inStr = false;
  let esc = false;
  const n = text.length;
  for (let j = start; j < n; j++) {
    const ch = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") stack.push(j);
    else if (ch === "]" || ch === "}") {
      const top = stack.at(-1);
      if (top === undefined || text[top] !== (ch === "}" ? "{" : "[")) {
        for (const p of stack) known.set(p, null);
        return [null, j - start + 1];
      }
      stack.pop();
      known.set(top, j + 1);
      if (stack.length === 0) return [j + 1, j - start + 1];
    }
  }
  for (const p of stack) known.set(p, null);
  return [null, n - start];
}

/**
 * Upstream scan_json_documents read as `complete and not spans`: no balanced bracket span (nested ones included)
 * parses as a JSON object or array. An exhausted walk or parse budget, or a parse failure other than a SyntaxError
 * (upstream: RecursionError), means the scan is incomplete, so false.
 * @param {string} text
 * @returns {boolean}
 */
function noJsonSpans(text) {
  const n = text.length;
  const budget = SCAN_BUDGET_PER_CHAR * n + SCAN_BUDGET_FLOOR;
  /** @type {Map<number, number|null>} */
  const known = new Map();
  let spent = 0;
  let i = 0;
  while (i < n) {
    if (text[i] === "[" || text[i] === "{") {
      /** @type {number|null|undefined} */
      let end;
      if (known.has(i)) end = known.get(i);
      else if (spent >= budget) return false;
      else {
        const [e, walked] = scanFrom(text, i, known);
        end = e;
        spent += walked;
      }
      if (typeof end === "number") {
        i = end;
        continue;
      }
    }
    i++;
  }
  let parsed = 0;
  for (const start of [...known.keys()].sort((a, b) => a - b)) {
    const end = known.get(start);
    if (typeof end !== "number") continue;
    if (parsed + end - start > budget) return false;
    parsed += end - start;
    let v;
    try {
      v = JSON.parse(text.slice(start, end));
    } catch (err) {
      if (err instanceof SyntaxError) continue;
      return false;
    }
    if (typeof v === "object" && v !== null) return false;
  }
  return true;
}

/**
 * Upstream is_dense_line: at least 300 characters, no tab, under 6% spaces (U+0020), not JSON-shaped once trimmed,
 * and holding no JSON document (a label may precede compact JSON, which only the SmartCrusher may rewrite).
 * @param {string} line
 * @returns {boolean}
 */
function isDenseLine(line) {
  const n = line.length;
  if (n < DENSE_MIN_LINE_CHARS || line.includes("\t") || (line.split(" ").length - 1) / n >= DENSE_MAX_SPACE_RATIO) return false;
  const s = line.trim();
  // "{[".includes("") is true like Python's "" in "{[": an all-whitespace line counts as JSON-shaped, as upstream.
  if ("{[".includes(s.slice(0, 1)) && "}]".includes(s.slice(-1))) return false;
  return noJsonSpans(line);
}

/**
 * Dense line elider (upstream dense_line_elider.py + ContentRouter._elide_dense): each long, nearly space-free line that
 * holds no JSON document keeps its first 160 and last 80 characters around an omission note, when the dense lines add
 * up to at least 2000 characters; the block then ends with a retrieval line and its original goes to the CCR store.
 * Undefined when nothing is dense or the result is not shorter.
 * @param {string} text
 * @returns {Elision|undefined}
 */
export function elideDense(text) {
  if (text.length < DENSE_MIN_LINE_CHARS) return undefined;
  const lines = text.split("\n"); // "\n" only: a "\r" stays on its line
  const dense = lines.map(isDenseLine);
  let total = 0;
  for (let i = 0; i < lines.length; i++) if (dense[i]) total += lines[i].length;
  if (total < DENSE_MIN_TOTAL_CHARS) return undefined;
  let n = 0;
  const out = lines.map((line, i) => {
    if (!dense[i]) return line;
    n++;
    const head = line.slice(0, pairSafeEnd(line, DENSE_HEAD_CHARS));
    const tail = line.slice(pairSafeStart(line, line.length - DENSE_TAIL_CHARS));
    return `${head} ...[${line.length - head.length - tail.length} chars of dense machine-generated content elided]... ${tail}`;
  });
  const hash = contentHash(text);
  const elided = `${out.join("\n")}\n[${n} dense machine-generated ${n === 1 ? "line" : "lines"} elided. Retrieve original: hash=${hash}]`;
  // Deviation: upstream emits a result that grew (seven 300-char lines plus the retrieval line); the mod passes it through.
  return elided.length < text.length ? { text: elided, lines: n, offloaded: [[hash, text]] } : undefined;
}

// Cross-turn dedup: a port of headroom's cross_turn_dedup.py, run once per appended tool-result text.

/**
 * Upstream _num_and_key: a leading unpadded line number, the match key (the line without that number, its separator
 * kept, so the same content at another line number shares a key) and the content after the separator.
 * Deviation: a number beyond Number.MAX_SAFE_INTEGER counts as no number (Python ints are unbounded).
 * @param {string} line
 * @returns {[number|null, string, string]}
 */
function numAndKey(line) {
  const m = DEDUP_LINENO_RE.exec(line);
  if (!m) return [null, line, line];
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? [n, m[2] + m[3], m[3]] : [null, line, line];
}

/**
 * Upstream _is_trivial: a line too short or too common to anchor a match on its own.
 * @param {string} content
 * @returns {boolean}
 */
function isTrivial(content) {
  const s = content.trim();
  return s.length < 4 || DEDUP_TRIVIAL.has(s);
}

/**
 * Upstream _index_lines: records each surviving non-trivial line as [ordinal, line] under its match key, first-seen
 * order, at most DEDUP_MAX_ANCHOR_CANDIDATES per key. Folded lines (null) are skipped (keep-earliest).
 * @param {readonly (string|null)[]} verbatim
 * @param {number} turn the block's ordinal
 * @param {DedupState} st
 * @returns {void}
 */
function indexLines(verbatim, turn, st) {
  verbatim.forEach((ln, li) => {
    if (ln === null) return;
    const [, key, content] = numAndKey(ln);
    if (isTrivial(content)) return;
    let bucket = st.index.get(key);
    if (!bucket) st.index.set(key, (bucket = []));
    if (bucket.length < DEDUP_MAX_ANCHOR_CANDIDATES) bucket.push([turn, li]);
  });
}

/**
 * Upstream _longest_match: the longest run of `cur` from `start` found in one earlier block, its line keys equal and
 * every numbered pair under one uniform line-number shift (non-numbered lines must match exactly). A longer run wins;
 * a tie keeps the earliest candidate. Undefined when no run starts here.
 * @param {readonly string[]} cur
 * @param {number} start
 * @param {DedupState} st
 * @returns {{ len: number, turn: number, li: number, delta: number }|undefined}
 */
function longestMatch(cur, start, st) {
  const candidates = st.index.get(numAndKey(cur[start])[1]);
  if (!candidates) return undefined;
  let best = { len: 0, turn: -1, li: -1, delta: 0 };
  for (const [t, li] of candidates) {
    const blockLines = st.corpus.get(t);
    if (!blockLines) continue;
    let k = 0;
    /** @type {number|null} */
    let delta = null;
    while (start + k < cur.length && li + k < blockLines.length) {
      const ca = cur[start + k];
      const cb = blockLines[li + k];
      if (cb === null) break; // a folded span ends the run
      const [na, ka] = numAndKey(ca);
      const [nb, kb] = numAndKey(cb);
      if (ka !== kb) break;
      if (na !== null && nb !== null) {
        const d = na - nb;
        if (delta === null) delta = d;
        else if (delta !== d) break; // an edit inside the span: the shift is not uniform
      } else if (ca !== cb) break;
      k++;
    }
    if (k > best.len) best = { len: k, turn: t, li, delta: delta ?? 0 };
  }
  return best.len === 0 ? undefined : best;
}

/**
 * Upstream _pointer plus a ` hash=H` CCR suffix: `[↑nL same as result K: "anchor" hash=H]`, with ` ±dL` after K when
 * the run's line numbers are shifted. The anchor is the run's first non-blank line's content, at most 20 code points.
 * @param {readonly string[]} span
 * @param {number} refTurn the earlier block's ordinal
 * @param {number} delta
 * @param {string} hash
 * @returns {string}
 */
function pointer(span, refTurn, delta, hash) {
  const first = span.find((ln) => ln.trim() !== "");
  const anchor = first === undefined ? "" : numAndKey(first)[2].trim();
  const points = [...anchor];
  const shown = points.length > 20 ? `${points.slice(0, 17).join("")}...` : anchor;
  const shift = delta === 0 ? "" : ` ${delta > 0 ? "+" : ""}${delta}L`;
  return `[↑${span.length}L same as result ${refTurn}${shift}: ${JSON.stringify(shown)} hash=${hash}]`;
}

/**
 * Cross-turn dedup (upstream cross_turn_dedup.py) for one tool-result text appended to conversation `key`: each run of
 * at least 3 lines and 40 characters found verbatim (or under one uniform line-number shift) in an earlier block of the
 * same conversation becomes a pointer naming that block's ordinal, with the run's own text stored under a CCR hash.
 * A protected text is only indexed. The block is then indexed, and the oldest conversations are dropped while all
 * corpora hold more than DEDUP_MAX_CHARS. Mutates `states`. Undefined when nothing folded.
 * @param {Map<string, DedupState>} states conversation key → corpus, least recently appended first
 * @param {string} key "" for the main loop, else the agentId
 * @param {string} text
 * @param {boolean} isProtected
 * @returns {Fold|undefined}
 */
export function dedupBlock(states, key, text, isProtected) {
  const st = states.get(key) ?? { turn: 0, corpus: new Map(), index: new Map(), chars: 0 };
  states.delete(key);
  states.set(key, st); // this conversation is now the most recently appended
  const turn = ++st.turn;
  const lines = text.split("\n");
  /** @type {string[]} */
  const out = [];
  /** @type {(string|null)[]} */
  const verbatim = isProtected ? [...lines] : [];
  /** @type {[string, string][]} */
  const offloaded = [];
  let spans = 0;
  for (let i = 0; !isProtected && i < lines.length;) {
    const m = longestMatch(lines, i, st);
    if (m && m.len >= DEDUP_MIN_LINES) {
      const span = lines.slice(i, i + m.len);
      const spanText = span.join("\n");
      if (spanText.length >= DEDUP_MIN_CHARS) {
        const hash = contentHash(spanText);
        const ptr = pointer(span, m.turn, m.delta, hash);
        // Deviation: the hash suffix can make a short run's pointer longer than the run; such a run stays verbatim.
        if (ptr.length < spanText.length) {
          out.push(ptr);
          for (let k = 0; k < m.len; k++) verbatim.push(null);
          offloaded.push([hash, spanText]);
          spans++;
          i += m.len;
          continue;
        }
      }
    }
    out.push(lines[i]);
    verbatim.push(lines[i]);
    i++;
  }
  indexLines(verbatim, turn, st);
  st.corpus.set(turn, verbatim);
  st.chars += text.length;
  let total = 0;
  for (const s of states.values()) total += s.chars;
  for (const [oldest, s] of states) {
    if (total <= DEDUP_MAX_CHARS) break;
    if (oldest === key) {
      // This conversation alone is over the cap: start its corpus over, but keep counting ordinals.
      st.corpus.clear();
      st.index.clear();
      st.chars = 0;
      break;
    }
    total -= s.chars;
    states.delete(oldest);
  }
  return spans > 0 ? { text: out.join("\n"), spans, offloaded } : undefined;
}

// The tool-result row pipeline (session.append): SmartCrusher, then the dense line elider, then cross-turn dedup.

/**
 * A tool_result block's texts as the model reads them: string content, or each text block of array content.
 * @param {Record<string, unknown>} block
 * @returns {string[]}
 */
function resultTexts(block) {
  const c = block.content;
  if (typeof c === "string") return [c];
  return Array.isArray(c) ? c.filter(isTextBlock).map((b) => b.text) : [];
}

/**
 * Whether a tool-result row holds text the SmartCrusher may rewrite, so the hook pays the transcript fetch only then.
 * @param {readonly ContentBlock[]} content the row's blocks
 * @param {string} tool the row's origin tool
 * @returns {boolean}
 */
export function wantsQuery(content, tool) {
  if (tool === RETRIEVE_TOOL || tool.startsWith(OWN_STORAGE_PREFIX)) return false;
  return content.some((b) => isRecord(b) && b.type === "tool_result" && b.is_error !== true && resultTexts(b).some(looksLikeJsonDoc));
}

/**
 * Rewrites a tool-result row's blocks before they are stored: per tool_result block, each text is crushed (one whole
 * JSON document) or else dense-line-elided, then a single-text result is deduplicated against earlier results of the
 * same conversation. Error blocks and headroom_retrieve / own-storage rows are never rewritten (dedup still indexes
 * them). Undefined when no block changed. Mutates levers.dedup.states.
 * @param {readonly ContentBlock[]} content the row's blocks
 * @param {string} tool the row's origin tool
 * @param {Levers} levers
 * @param {string} query the conversation context (crushQuery), "" for none
 * @returns {RowRewrite|undefined}
 */
export function rewriteToolResults(content, tool, levers, query) {
  const rowProtected = tool === RETRIEVE_TOOL || tool.startsWith(OWN_STORAGE_PREFIX);
  /** @type {Omit<RowRewrite, "content">} */
  const acc = { offloaded: [], crush: { dropped: 0, saved: 0 }, elide: { lines: 0, saved: 0 }, dedup: { spans: 0, saved: 0 } };
  let changed = false;
  /** @type {ContentBlock[]} */
  const mapped = content.map((b) => {
    if (!isRecord(b) || b.type !== "tool_result") return b;
    const prot = rowProtected || b.is_error === true;
    /**
     * The crusher's rewrite of one text, else the elider's (upstream elides only text no JSON strategy rewrote).
     * @param {string} text
     * @returns {string}
     */
    const shrink = (text) => {
      if (prot) return text;
      const c = levers.crush ? crushJson(text, query) : undefined;
      if (c) {
        acc.crush.dropped += c.rowsDropped;
        acc.crush.saved += text.length - c.text.length;
        acc.offloaded.push(...c.offloaded);
        return c.text;
      }
      const d = levers.elide ? elideDense(text) : undefined;
      if (d) {
        acc.elide.lines += d.lines;
        acc.elide.saved += text.length - d.text.length;
        acc.offloaded.push(...d.offloaded);
        return d.text;
      }
      return text;
    };
    /**
     * Cross-turn dedup of a result's final text; a protected text is only indexed.
     * @param {string} text
     * @returns {string}
     */
    const fold = (text) => {
      const f = levers.dedup ? dedupBlock(levers.dedup.states, levers.dedup.key, text, prot) : undefined;
      if (!f) return text;
      acc.dedup.spans += f.spans;
      acc.dedup.saved += text.length - f.text.length;
      acc.offloaded.push(...f.offloaded);
      return f.text;
    };
    const c = b.content;
    if (typeof c === "string") {
      let t = shrink(c);
      if (t !== "") t = fold(t);
      if (t === c) return b;
      changed = true;
      return { ...b, content: t };
    }
    if (!Array.isArray(c)) return b;
    let touched = false;
    /** @type {unknown[]} */
    const items = c.map((x) => {
      if (!isTextBlock(x)) return x;
      const text = shrink(x.text);
      if (text === x.text) return x;
      touched = true;
      return { ...x, text };
    });
    // Upstream dedups only a result with exactly one non-empty text block; multi-text results stay verbatim and unindexed.
    const texts = items.flatMap((x, i) => (isTextBlock(x) && x.text !== "" ? [i] : []));
    if (texts.length === 1) {
      const it = /** @type {{ type: "text", text: string }} */ (items[texts[0]]);
      const text = fold(it.text);
      if (text !== it.text) {
        items[texts[0]] = { ...it, text };
        touched = true;
      }
    }
    if (!touched) return b;
    changed = true;
    return { ...b, content: items };
  });
  return changed ? { content: mapped, ...acc } : undefined;
}
