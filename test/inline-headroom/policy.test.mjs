import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CACHE_DROP_THRESHOLD,
  CCR_CAPACITY,
  CRUSH_MIN_CHARS,
  EFFORT_ORDER,
  ERROR_KEYWORDS,
  MAX_FINDINGS,
  RETAIN_DAYS,
  RETRIEVE_TOOL,
  ROWS,
  cacheHitRatio,
  clampEffort,
  computeOptimalK,
  crushQuery,
  dayKey,
  findVolatile,
  foldPending,
  isCacheDrop,
  isToolError,
  statsTables,
  stepEffort,
  storeOffloaded,
  tableText,
  toCount,
  windowStart,
  zeroCounters,
} from "../../plugins/inline-headroom/hooks/policy.mjs";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const ISO = "2026-10-03T12:00:00Z";
const JWT = "eyJa.b.c";
const SHA1 = "da39a3ee5e6b4b0d3255bfef95601890afd80709";

/**
 * @param {string} text
 * @param {'shared'|'session'} [scope]
 */
const sec = (text, scope = "shared") => [{ id: "s1", text, scope }];

test("constants match the spec", () => {
  assert.deepEqual([...EFFORT_ORDER], ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(MAX_FINDINGS, 10);
  assert.equal(CACHE_DROP_THRESHOLD, 0.6);
  assert.deepEqual(
    ROWS.map((v) => v.label),
    ["session", "today", "7 days", "30 days"],
  );
  assert.deepEqual(
    ROWS.map((v) => v.days),
    [0, 1, 7, 30],
  );
  assert.equal(RETAIN_DAYS, 30);
  assert.ok(RETAIN_DAYS >= Math.max(...ROWS.map((v) => v.days)));
  assert.equal(RETRIEVE_TOOL, "mcp__inline-headroom__headroom_retrieve");
  assert.equal(CRUSH_MIN_CHARS, 800);
  assert.equal(CCR_CAPACITY, 1000);
  assert.deepEqual([...ERROR_KEYWORDS], ["error", "exception", "failed", "failure", "critical", "fatal", "crash", "panic", "abort", "timeout", "denied", "rejected"]);
  assert.ok(ERROR_KEYWORDS.every((k) => k === k.toLowerCase()));
});

test("clampEffort lowers every level above low to low", () => {
  for (const level of ["xhigh", "max", "high", "medium"]) {
    assert.equal(clampEffort(level), "low", level);
  }
});

test("clampEffort never raises, never injects, skips numeric and unknown", () => {
  assert.equal(clampEffort("low"), undefined);
  assert.equal(clampEffort(7), undefined);
  assert.equal(clampEffort(undefined), undefined);
  assert.equal(clampEffort("bogus"), undefined);
});

test("clampEffort honours an explicit target", () => {
  assert.equal(clampEffort("max", "medium"), "medium");
  assert.equal(clampEffort("low", "medium"), undefined);
});

test("stepEffort clamps only a mechanical step: after index 0, no tool error", () => {
  assert.equal(stepEffort(1, false, "xhigh"), "low");
  assert.equal(stepEffort(0, false, "xhigh"), undefined);
  assert.equal(stepEffort(1, true, "xhigh"), undefined);
  assert.equal(stepEffort(1, false, "low"), undefined);
});

test("isToolError: isError true or a deny string is an error", () => {
  assert.equal(isToolError({ isError: true }), true);
  assert.equal(isToolError({ deny: "x" }), true);
  assert.equal(isToolError({ result: {} }), false);
  assert.equal(isToolError({ isError: false }), false);
});

test("findVolatile flags each class in a shared section with a truncated sample", () => {
  /** @type {[string, string][]} */
  const cases = [
    [UUID, "uuid"],
    [ISO, "iso8601"],
    [JWT, "jwt"],
    [SHA1, "hex_hash"],
  ];
  for (const [tok, kind] of cases) {
    const found = findVolatile(sec(`value (${tok}) seen at start.`));
    assert.deepEqual(found, [{ id: "s1", kind, sample: tok.slice(0, 12) + "…" }], kind);
  }
});

test("findVolatile strips trailing dot and colon from tokens", () => {
  assert.deepEqual(
    findVolatile(sec(`Started at ${ISO}.`)).map((f) => f.kind),
    ["iso8601"],
  );
  assert.deepEqual(
    findVolatile(sec(`id ${UUID}:`)).map((f) => f.kind),
    ["uuid"],
  );
});

test("findVolatile never returns the full value", () => {
  const [finding] = findVolatile(sec(UUID));
  assert.equal(finding.sample, "123e4567-e89…");
  assert.ok(!finding.sample.includes(UUID));
});

test("findVolatile ignores session sections", () => {
  assert.deepEqual(findVolatile(sec(`${UUID} ${ISO} ${JWT} ${SHA1}`, "session")), []);
});

test("findVolatile does not flag filenames, short hashes, prose or clock times", () => {
  assert.deepEqual(findVolatile(sec("Edit foo.test.ts at 12:30 after commit 71f117b, plain prose only.")), []);
});

test("findVolatile stops at MAX_FINDINGS", () => {
  const text = Array.from({ length: 15 }, () => UUID).join(" ");
  assert.equal(findVolatile(sec(text)).length, 10);
});

test("cacheHitRatio is read / (input + read + creation), undefined on zero total", () => {
  assert.equal(
    cacheHitRatio({
      input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }),
    undefined,
  );
  assert.equal(
    cacheHitRatio({
      input_tokens: 100,
      cache_read_input_tokens: 600,
      cache_creation_input_tokens: 300,
    }),
    0.6,
  );
});

test("isCacheDrop only fires when crossing the threshold from at-or-above to below", () => {
  assert.equal(isCacheDrop(undefined, 0.1), false);
  assert.equal(isCacheDrop(0.9, 0.1), true);
  assert.equal(isCacheDrop(0.5, 0.1), false);
  assert.equal(isCacheDrop(0.9, 0.7), false);
});

test("dayKey is the local calendar day for an explicit UTC offset", () => {
  assert.equal(dayKey(Date.UTC(2026, 9, 3, 23, 30), -120), "2026-10-04");
  assert.equal(dayKey(Date.UTC(2026, 9, 3, 23, 30), 0), "2026-10-03");
  assert.equal(dayKey(Date.UTC(2026, 9, 3, 0, 30), 60), "2026-10-02");
});

test("dayKey defaults to this runtime's offset at that instant", () => {
  const ms = Date.UTC(2026, 9, 3, 12);
  assert.equal(dayKey(ms), dayKey(ms, new Date(ms).getTimezoneOffset()));
});

test("windowStart counts calendar days back with today included, across leap day, year end and DST", () => {
  assert.equal(windowStart("2026-10-03", 1), "2026-10-03");
  assert.equal(windowStart("2026-10-03", 7), "2026-09-27");
  assert.equal(windowStart("2026-10-03", 30), "2026-09-04");
  assert.equal(windowStart("2024-03-01", 2), "2024-02-29");
  assert.equal(windowStart("2026-01-03", 7), "2025-12-28");
  assert.equal(windowStart("2026-03-30", 2), "2026-03-29");
});

test("statsTables builds both tables, with blank for rows without counters", () => {
  const c = {
    ...zeroCounters(),
    steps: 12,
    clamped: 7,
    cache_drops: 1,
    input_tokens: 60,
    cache_read_input_tokens: 940,
  };
  assert.deepEqual(statsTables([c, c, undefined, undefined], "…"), [
    [
      ["effort routing", "steps", "clamped"],
      ["session", "12", "7"],
      ["today", "12", "7"],
      ["7 days", "…", "…"],
      ["30 days", "…", "…"],
    ],
    [
      ["cache aligner", "hit", "drops"],
      ["session", "94%", "1"],
      ["today", "94%", "1"],
      ["7 days", "…", "…"],
      ["30 days", "…", "…"],
    ],
  ]);
  assert.equal(statsTables([zeroCounters()], "–")[1][1][1], "–"); // no tokens: no hit ratio
  assert.equal(statsTables([{ ...c, hit: 0.1 }], "…")[1][1][1], "10%"); // a row's own hit wins over the token-weighted one
});

test("tableText pads the label column and right-aligns the values", () => {
  assert.equal(
    tableText([
      ["effort routing", "steps", "clamped"],
      ["7 days", "340", "120"],
    ]),
    "effort routing     steps clamped\n7 days               340     120",
  );
});

test("toCount keeps non-negative safe integers and turns everything else into 0", () => {
  assert.equal(toCount(0), 0);
  assert.equal(toCount(42), 42);
  assert.equal(toCount(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  for (const bad of [undefined, null, NaN, Infinity, -1, 1.5, 2 ** 53, "7"]) assert.equal(toCount(bad), 0, String(bad));
});

test("foldPending adds pending into today's row, zeroes pending in place and returns copies", () => {
  /** @type {Record<string, import("../../plugins/inline-headroom/hooks/policy.mjs").Counters>} */
  const days = {};
  const pending = zeroCounters();
  pending.steps = 2;
  pending.input_tokens = 100;
  assert.deepEqual(foldPending(days, pending, "2026-10-03", "2026-09-04"), [{ day: "2026-10-03", ...zeroCounters(), steps: 2, input_tokens: 100 }]);
  assert.deepEqual(pending, zeroCounters());
  pending.steps = 3;
  pending.cache_drops = 1;
  const rows = foldPending(days, pending, "2026-10-03", "2026-09-04");
  assert.deepEqual(rows, [{ day: "2026-10-03", ...zeroCounters(), steps: 5, cache_drops: 1, input_tokens: 100 }]);
  days["2026-10-03"].steps = 99;
  assert.equal(rows[0].steps, 5);
});

test("foldPending drops days before purgeBefore and after today, keeping the window", () => {
  /** @type {Record<string, import("../../plugins/inline-headroom/hooks/policy.mjs").Counters>} */
  const days = { "2026-09-03": zeroCounters(), "2026-09-04": zeroCounters(), "2026-10-02": zeroCounters(), "2026-10-04": zeroCounters() };
  const rows = foldPending(days, zeroCounters(), "2026-10-03", "2026-09-04");
  assert.deepEqual(Object.keys(days).sort(), ["2026-09-04", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(rows.map((r) => r.day).sort(), ["2026-09-04", "2026-10-02", "2026-10-03"]);
});

test("computeOptimalK keeps every row up to 8, 3 for redundant rows and at most 15 otherwise", () => {
  assert.equal(computeOptimalK(["a", "b", "c", "d", "e"]), 5);
  assert.equal(computeOptimalK(Array.from({ length: 30 }, () => "abc")), 3);
  assert.equal(computeOptimalK(Array.from({ length: 20 }, (_, i) => `unique item number ${i} with some long content`)), 15);
  const k = computeOptimalK(Array.from({ length: 30 }, (_, i) => `item content ${i}`));
  assert.ok(k >= 3 && k <= 15, String(k));
});

test("storeOffloaded evicts the oldest entry beyond CCR_CAPACITY", () => {
  /** @type {Map<string, string>} */
  const store = new Map();
  storeOffloaded(
    store,
    Array.from({ length: CCR_CAPACITY + 1 }, (_, i) => /** @type {[string, string]} */ ([`h${i}`, `[${i}]`])),
  );
  assert.equal(store.size, CCR_CAPACITY);
  assert.equal(store.has("h0"), false);
  assert.equal(store.get(`h${CCR_CAPACITY}`), `[${CCR_CAPACITY}]`);
});

test("storeOffloaded moves a re-put hash to the newest position, so it outlives older ones", () => {
  /** @type {Map<string, string>} */
  const store = new Map();
  storeOffloaded(
    store,
    Array.from({ length: CCR_CAPACITY }, (_, i) => /** @type {[string, string]} */ ([`h${i}`, "[]"])),
  );
  storeOffloaded(store, [["h0", "[0]"]]);
  assert.equal([...store.keys()].at(-1), "h0");
  storeOffloaded(store, [["new", "[1]"]]);
  assert.equal(store.get("h0"), "[0]");
  assert.equal(store.has("h1"), false);
});

test("crushQuery walks back from the last message, stops after the 5th user message and adds tool-call input JSON", () => {
  /** @type {import("../../plugins/inline-headroom/hooks/policy.mjs").QueryMessage[]} */
  const messages = [
    { role: "user", text: "too old", toolUses: [] },
    { role: "user", text: "u1", toolUses: [] },
    { role: "assistant", text: "a1", toolUses: [{ input: { command: "ls" } }] },
    { role: "user", text: "", toolUses: [] }, // tool results only: counts, adds no text
    { role: "user", text: "u3", toolUses: [] },
    { role: "user", text: "u4", toolUses: [] },
    { role: "assistant", text: "", toolUses: [{ input: { file_path: "a.json" } }] },
    { role: "user", text: "u5", toolUses: [] },
    { role: "assistant", text: "in flight", toolUses: [{ input: { command: "cat data.json" } }] },
  ];
  assert.equal(crushQuery(messages), '{"command":"cat data.json"} u5 {"file_path":"a.json"} u4 u3 {"command":"ls"} u1');
  assert.equal(crushQuery([]), "");
});
