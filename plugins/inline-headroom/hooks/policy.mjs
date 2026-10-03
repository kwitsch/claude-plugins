// Pure policy for inline-headroom. Never reference the mods `$` here: the
// engine's validation rejects passing the mods API into functions imported
// from another file. All `$` use lives inside hooks in register.ts.

/** @typedef {'low'|'medium'|'high'|'xhigh'|'max'} Effort */
/** @typedef {'uuid'|'iso8601'|'jwt'|'hex_hash'} VolatileKind */
/** @typedef {{id: string, kind: VolatileKind, sample: string}} VolatileFinding */

export const EFFORT_ORDER = /** @type {const} */ (["low", "medium", "high", "xhigh", "max"]);
export const CACHE_DROP_THRESHOLD = 0.6;
export const MAX_FINDINGS = 10;

const TOKEN_SPLIT = /[\s"'`()<>[\]{},;]+/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}.*)?$/;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const HEX_RE = /^[0-9a-f]+$/i;
const HEX_LENGTHS = new Set([32, 40, 64]);

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
