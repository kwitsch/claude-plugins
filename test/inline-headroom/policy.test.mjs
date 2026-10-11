import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CACHE_DROP_THRESHOLD,
  CCR_CAPACITY,
  CCR_MAX_CHARS,
  CRUSH_MIN_CHARS,
  CRUSH_QUERY_INPUT_CHARS,
  DEDUP_MAX_CHARS,
  EFFORT_ORDER,
  ERROR_KEYWORDS,
  MAX_FINDINGS,
  RETAIN_DAYS,
  RETRIEVE_TOOL,
  ROWS,
  cacheHitRatio,
  clampEffort,
  compactRows,
  compactionJson,
  computeOptimalK,
  crushJson,
  crushQuery,
  dayKey,
  detectContentType,
  dedupBlock,
  elideDense,
  findVolatile,
  foldPending,
  formatCsvSchema,
  isCacheDrop,
  isOwnStorageCall,
  isToolError,
  resetCorpus,
  retrieveKey,
  rewriteToolResults,
  statsTables,
  stepEffort,
  storeOffloaded,
  tableText,
  toCount,
  wantsQuery,
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

test("isOwnStorageCall allows only this mod's own calls to its storage tools", () => {
  assert.equal(isOwnStorageCall("inline-headroom", "mcp__plugin_inline-headroom_storage__stats_put"), true);
  assert.equal(isOwnStorageCall("engine", "mcp__plugin_inline-headroom_storage__stats_put"), false); // the model's own call
  assert.equal(isOwnStorageCall("other-plugin", "mcp__plugin_inline-headroom_storage__kv_set"), false);
  assert.equal(isOwnStorageCall("inline-headroom", "mcp__plugin_other_storage__kv_set"), false);
  assert.equal(isOwnStorageCall("inline-headroom", "Bash"), false);
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

test("statsTables builds every table, with blank for rows without counters", () => {
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
    [
      ["smart crusher", "dropped", "saved"],
      ["session", "0", "0"],
    ],
    [
      ["dedup", "spans", "saved"],
      ["session", "0", "0"],
    ],
    [
      ["line elider", "lines", "saved"],
      ["session", "0", "0"],
    ],
    [
      ["compaction", "arrays", "saved"],
      ["session", "0", "0"],
    ],
  ]);
  // The in-memory rows: subagents right under the effort session row, the crusher's session counts.
  const [effort, , crusher] = statsTables([c], "…", { subagents: { steps: 4, clamped: 3 }, crush: { dropped: 40, saved: 1200 } });
  assert.deepEqual(effort.slice(1, 4), [
    ["session", "12", "7"],
    ["subagents", "4", "3"],
    ["today", "…", "…"],
  ]);
  assert.deepEqual(crusher[1], ["session", "40", "1200"]);
  const [, , , deduper, elider] = statsTables([c], "…", { dedup: { spans: 3, saved: 900 }, elide: { lines: 2, saved: 4100 } });
  assert.deepEqual(deduper[1], ["session", "3", "900"]);
  assert.deepEqual(elider[1], ["session", "2", "4100"]);
  const [, , , , , compactor] = statsTables([c], "…", { compact: { arrays: 2, saved: 5300 } });
  assert.deepEqual(compactor[1], ["session", "2", "5300"]);
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
    Array.from({ length: CCR_CAPACITY }, (_, i) => /** @type {[string, string]} */ ([`h${i}`, `[${i}]`])),
  );
  storeOffloaded(store, [["new", "[new]"]]);
  assert.equal(store.size, CCR_CAPACITY);
  assert.equal(store.has("h0"), false);
  assert.equal(store.get("new"), "[new]");
});

test("storeOffloaded never evicts the entries it was just given, even when they alone pass a cap", () => {
  /** @type {Map<string, string>} */
  const store = new Map([["old", "[old]"]]);
  const batch = Array.from({ length: CCR_CAPACITY + 1 }, (_, i) => /** @type {[string, string]} */ ([`h${i}`, `[${i}]`]));
  storeOffloaded(store, batch);
  assert.equal(store.has("old"), false); // the older entry went first
  assert.deepEqual(
    [...store.keys()],
    batch.map(([hash]) => hash),
  ); // all 1001 stay: their markers are about to be stored
  const huge = "x".repeat(CCR_MAX_CHARS + 1);
  storeOffloaded(store, [["huge", huge]]);
  assert.equal(store.get("huge"), huge); // a single original over CCR_MAX_CHARS stays until the next call
  assert.equal(store.has("h0"), false);
  storeOffloaded(store, [["next", "[next]"]]);
  assert.deepEqual([...store.keys()], ["next"]); // then the older entries go, over-cap `huge` among them
});

test("storeOffloaded evicts the oldest entries beyond CCR_MAX_CHARS", () => {
  /** @type {Map<string, string>} */
  const store = new Map();
  const third = "x".repeat(Math.floor(CCR_MAX_CHARS / 3));
  storeOffloaded(store, [
    ["a", third],
    ["b", third],
    ["c", third],
  ]);
  assert.deepEqual([...store.keys()], ["a", "b", "c"]); // exactly at the cap: all kept
  storeOffloaded(store, [["d", "[1]"]]);
  assert.deepEqual([...store.keys()], ["b", "c", "d"]);
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

test("retrieveKey takes a bare hash, one with its marker's hash= or <<ccr: prefix and closing bracket, and nothing else", () => {
  assert.equal(retrieveKey("abc123def456"), "abc123def456");
  assert.equal(retrieveKey(" hash=abc123def456 "), "abc123def456");
  assert.equal(retrieveKey("<<ccr:abc123def456 40_rows_offloaded>>"), "abc123def456");
  assert.equal(retrieveKey("hash=abc123def456]"), "abc123def456"); // the tail of a dedup pointer or an elider line
  assert.equal(retrieveKey("<<ccr:abc123def456>>"), "abc123def456");
  assert.equal(retrieveKey(""), "");
  assert.equal(retrieveKey(42), undefined);
  assert.equal(retrieveKey(undefined), undefined);
});

test("crushQuery walks back from the last message, stops after the 5th user message with text and adds tool-call input JSON", () => {
  /** @type {import("../../plugins/inline-headroom/hooks/policy.mjs").QueryMessage[]} */
  const messages = [
    { role: "user", text: "too old", toolUses: [] },
    { role: "user", text: "u1", toolUses: [] },
    { role: "user", text: "u2", toolUses: [] },
    { role: "assistant", text: "a1", toolUses: [{ input: { command: "ls" } }] },
    { role: "user", text: "", toolUses: [] }, // tool results only: neither counts nor adds text
    { role: "user", text: "", toolUses: [] },
    { role: "user", text: "u3", toolUses: [] },
    { role: "user", text: "u4", toolUses: [] },
    { role: "assistant", text: "", toolUses: [{ input: { file_path: "a.json" } }] },
    { role: "user", text: "u5", toolUses: [] },
    { role: "assistant", text: "in flight", toolUses: [{ input: { command: "cat data.json" } }] },
  ];
  assert.equal(crushQuery(messages), '{"command":"cat data.json"} u5 {"file_path":"a.json"} u4 u3 {"command":"ls"} u2 u1');
  assert.equal(crushQuery([]), "");
});

test("crushQuery keeps at most CRUSH_QUERY_INPUT_CHARS of tool-call input, newest first, and still reaches the request", () => {
  /** @param {string} c */
  const write = (c) =>
    /** @type {import("../../plugins/inline-headroom/hooks/policy.mjs").QueryMessage} */ ({ role: "assistant", text: "", toolUses: [{ input: { content: c.repeat(CRUSH_QUERY_INPUT_CHARS) } }] });
  // A subagent: one user message, then more tool-call input than the cap.
  const query = crushQuery([{ role: "user", text: "find the failing tests", toolUses: [] }, write("a"), write("b"), write("c")]);
  assert.equal(query.length, CRUSH_QUERY_INPUT_CHARS + " find the failing tests".length);
  assert.ok(query.startsWith('{"content":"ccc')); // the newest input fills the budget
  assert.ok(!query.includes("bbb") && !query.includes("aaa")); // older inputs are skipped, not stringified
  assert.ok(query.endsWith(" find the failing tests")); // the request itself is still the last part
});

const SENTINEL = /^<<ccr:([0-9a-f]{12}) (\d+)_rows_offloaded>>$/;
// 200 rows that only differ by id, one with an error status: crushable, K = 15.
const STATUS_ROWS = Array.from({ length: 200 }, (_, i) => ({ id: i, status: i === 150 ? "error" : "ok", note: "same text" }));

/**
 * crushJson over `text`, its output parsed back; throws when the text passes through.
 * @param {string} text
 * @param {string} [query]
 */
function crushText(text, query = "") {
  const r = crushJson(text, query);
  if (!r) throw new Error("expected crushJson to rewrite the document");
  return { ...r, out: JSON.parse(r.text) };
}

/**
 * crushText over `value` as compact JSON.
 * @param {unknown} value
 * @param {string} [query]
 */
const crush = (value, query = "") => crushText(JSON.stringify(value), query);

/**
 * The kept rows' ids, without the CCR sentinel.
 * @param {{ id?: unknown, _ccr_dropped?: string }[]} rows
 */
const keptIds = (rows) => rows.filter((r) => !("_ccr_dropped" in r)).map((r) => r.id);

test("crushJson passes through what it cannot or need not crush", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: i, status: "ok", note: "the same note on every row" }));
  assert.ok(crushJson(JSON.stringify(rows), "")); // crushable as it is: the guards below are what stop it
  const body = JSON.stringify(rows).slice(1, -1);
  for (const text of [
    "{" + "x".repeat(900), // invalid JSON
    JSON.stringify("x".repeat(900)), // a JSON scalar
    JSON.stringify(rows.slice(0, 10)), // 800 chars or less
    `[${body},{"id":12345678901234567890}]`, // an integer JSON.parse would round
    `[${body},{"id":1e400}]`, // a number JSON.parse turns into Infinity
    `[${body},{"amount":1234567.89012345678901}]`, // a decimal with more than 17 significant digits
    `[${body},{"neg":-0}]`, // JSON.stringify prints -0 as 0
    `[${body},{"a":1,"a":2}]`, // a duplicate key: the first value would vanish
    String.raw`[${body},{"u":1,"u":2}]`, // a duplicate through an escape
    JSON.stringify({ text: "x".repeat(900) }), // an unchanged compact object
    JSON.stringify({ rows: rows.slice(0, 4).map((r) => ({ ...r, note: "y".repeat(300) })) }), // fewer than 5 rows are never crushed
  ])
    assert.equal(crushJson(text, ""), undefined, text.slice(0, 60));
});

test("crushJson still crushes numbers that survive the round trip and keys that merely look alike", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: i, status: "ok", note: "the same note on every row" }));
  const body = JSON.stringify(rows).slice(1, -1);
  const extra = String.raw`{"a":1.5,"b":0.1234567890123456,"c":1e21,"d":9007199254740992,"e":"x\":1,\"x\":2","a ":3,"f":0.0}`;
  assert.ok(crushJson(`[${body},${extra}]`, ""));
});

test("crushJson passes pretty JSON through when no row is dropped", () => {
  const doc = { groups: Array.from({ length: 6 }, (_, g) => ({ name: `group ${g}`, rows: Array.from({ length: 8 }, (_, i) => ({ id: i, note: "kept as is" })) })) };
  assert.equal(crushJson(JSON.stringify(doc, null, 2), ""), undefined);
});

test("crushJson keeps the error row among 1000 near-identical rows and ends the array with a CCR sentinel", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => (i === 998 ? { id: i, status: "ERROR", msg: "FATAL: boom" } : { id: i, status: "ok", msg: "all good" }));
  const r = crush(rows);
  const [, hash, n] = SENTINEL.exec(r.out.at(-1)._ccr_dropped) ?? [];
  assert.ok(keptIds(r.out).includes(998));
  assert.ok(r.out.length - 1 <= 16, String(r.out.length));
  assert.equal(Number(n), 1000 - (r.out.length - 1));
  assert.equal(r.rowsDropped, Number(n));
  assert.deepEqual(r.offloaded, [[hash, JSON.stringify(rows)]]);
});

test("crushJson keeps a row holding a rare field", () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({ id: i, kind: "common", note: "the same note on every row", ...(i === 20 ? { rare_extra_field: "x" } : {}) }));
  const r = crush(rows);
  assert.ok(r.rowsDropped > 0);
  assert.ok(keptIds(r.out).includes(20));
});

test("crushJson keeps rows with rare status values, and flags none when values are uniform", () => {
  const held = [10, 30, 50, 70, 90];
  const dominant = crush(Array.from({ length: 100 }, (_, i) => ({ id: i, status: held.includes(i) ? "held" : "ok" })));
  for (const i of held) assert.ok(keptIds(dominant.out).includes(i), String(i));
  // 60 info, 25 warn, 15 distinct codes: the top two values cover 85%, so all 15 codes are rare.
  const bimodal = crush(Array.from({ length: 100 }, (_, i) => ({ id: i, level: i < 60 ? "info" : i < 85 ? "warn" : `e${i - 85}` })));
  for (let i = 85; i < 100; i++) assert.ok(keptIds(bimodal.out).includes(i), String(i));
  // 50 values twice each: no rare value, so no signal, and the unique ids make the array unsafe to sample.
  assert.equal(crushJson(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i, code: `c${Math.floor(i / 2)}` }))), ""), undefined);
});

test("crushJson keeps a numeric anomaly more than 2 sigma from the mean", () => {
  const r = crush(Array.from({ length: 60 }, (_, i) => ({ id: i, value: i === 37 ? 1000 : 10 + (i % 3), note: "steady" })));
  assert.ok(r.rowsDropped > 0);
  assert.ok(keptIds(r.out).includes(37));
});

test("crushJson ignores query terms and anchors found in most rows", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: 48200 + i, title: `row ${i} alpha beta gamma`, status: i === 5 ? "failed" : "ok", host: "api.example.com" }));
  const kept = keptIds(crush(rows, "row alpha status ok 48313 api.example.com").out);
  assert.ok(kept.includes(48313), String(kept));
  // A non-selective term would mark every row relevant and collapse the kept rows to the head.
  assert.deepEqual(kept, keptIds(crush(rows, "48313").out));
});

test("crushJson keeps a row the query names that an empty query drops", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: 48200 + i, title: `row ${i} alpha beta gamma`, status: i === 5 ? "failed" : "ok" }));
  assert.ok(!keptIds(crush(rows).out).includes(48213));
  assert.ok(keptIds(crush(rows, "show me 48213").out).includes(48213));
});

test("crushJson never samples unique entities without a signal", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, title: `Gardening tip number ${String(i).padStart(3, "0")} for spring beds` }));
  assert.equal(crushJson(JSON.stringify(rows, null, 2), ""), undefined);
});

test("crushJson keeps the K - 3 top-scored search results", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: i, score: Math.round((1 - i * 0.02) * 100) / 100, title: `result ${i} about topic` }));
  assert.deepEqual(
    keptIds(crush(rows).out),
    Array.from({ length: 12 }, (_, i) => i),
  );
});

test("crushJson keeps the rows around a time series change point", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: i, ts: `2026-10-01T00:${String(i).padStart(2, "0")}:00Z`, value: i < 50 ? 10 : 50, note: `reading ${i} from sensor alpha` }));
  const kept = keptIds(crush(rows).out);
  for (let i = 47; i <= 51; i++) assert.ok(kept.includes(i), String(i));
});

test("crushJson maps a change point past null values back to its row", () => {
  // 10 leading nulls: the shift sits at row 50 but at index 40 of the non-null values.
  const rows = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    ts: `2026-10-01T00:${String(i).padStart(2, "0")}:00Z`,
    value: i < 10 ? null : i < 50 ? 10 : 50,
    note: `reading ${i} from sensor alpha`,
  }));
  const kept = keptIds(crush(rows).out);
  // The null rows take part of the K budget, so only the window's start is asserted, and no row around index 40.
  assert.ok(kept.includes(48) && kept.includes(49), String(kept));
  assert.ok(!kept.some((i) => typeof i === "number" && i >= 38 && i <= 42), String(kept));
});

test("crushJson samples log rows by cluster and keeps every error-level row", () => {
  const messages = ["started job", "finished job", "retrying job", "queued job"];
  const rows = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    level: i % 20 === 7 ? "error" : i % 2 ? "info" : "warn",
    message: messages[i % 4],
    detail: `request ${i} handled by worker pool with trace abc${i}`,
  }));
  const r = crush(rows);
  assert.ok(r.rowsDropped > 0);
  for (const i of [7, 27, 47]) assert.ok(keptIds(r.out).includes(i), String(i));
});

test("crushJson keeps every object key, crushes nested and stringified dict arrays, and leaves depth 50 alone", () => {
  const nested = crush({ meta: { source: "api", page: 1 }, rows: STATUS_ROWS });
  assert.deepEqual(Object.keys(nested.out), ["meta", "rows"]);
  assert.deepEqual(nested.out.meta, { source: "api", page: 1 });
  assert.match(nested.out.rows.at(-1)._ccr_dropped, SENTINEL);
  const stringified = crush({ payload: JSON.stringify(STATUS_ROWS) });
  assert.equal(typeof stringified.out.payload, "string");
  assert.match(JSON.parse(stringified.out.payload).at(-1)._ccr_dropped, SENTINEL);
  /**
   * @param {number} depth
   * @returns {unknown} STATUS_ROWS under `depth` objects
   */
  const wrap = (depth) => (depth === 0 ? STATUS_ROWS : { inner: wrap(depth - 1) });
  assert.ok(crushJson(JSON.stringify(wrap(49)), ""));
  assert.equal(crushJson(JSON.stringify(wrap(50)), ""), undefined);
});

test('crushJson keeps a "__proto__" key as an own data property', () => {
  const r = crushText(`{"__proto__":{"x":1},"rows":${JSON.stringify(STATUS_ROWS)}}`);
  assert.ok(r.text.startsWith('{"__proto__":{"x":1},"rows":['));
  assert.ok(Object.hasOwn(r.out, "__proto__"));
  assert.equal(Object.getPrototypeOf(r.out), Object.prototype);
});

test("crushJson is deterministic", () => {
  const text = JSON.stringify({ rows: STATUS_ROWS });
  assert.equal(crushJson(text, "status 150")?.text, crushJson(text, "status 150")?.text);
});

test("crushJson's shared parse never leaks a value or accepts whitespace JSON forbids", () => {
  const text = JSON.stringify({ rows: STATUS_ROWS });
  const first = crushJson(text, "")?.text;
  assert.ok(first);
  assert.equal(detectContentType(text), "json_array"); // the detector's parse of the same text in between
  assert.equal(crushJson(text, "")?.text, first);
  assert.equal(crushJson(` \n${text}\t\r`, "")?.text, first); // JSON whitespace around a value parses alike
  assert.equal(crushJson(text + String.fromCharCode(0xa0), ""), undefined); // trim() strips NBSP, JSON.parse does not: passed through
});

const BIG = JSON.stringify(STATUS_ROWS);

const HASH_RE = /^[0-9a-f]{12}$/;
// Any lone (unpaired) UTF-16 surrogate: a cut that splits a pair leaves one behind.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * elideDense that must rewrite; throws when the text passes through.
 * @param {string} text
 */
function elide(text) {
  const r = elideDense(text);
  if (!r) throw new Error("expected elideDense to rewrite the text");
  return r;
}

/**
 * The omission note a dense line becomes: its head, the count of characters cut, its tail.
 * @param {string} head
 * @param {number} omitted
 * @param {string} tail
 */
const elidedLine = (head, omitted, tail) => `${head} ...[${omitted} chars of dense machine-generated content elided]... ${tail}`;

test("elideDense keeps a dense line's first 160 and last 80 characters and ends the block with a retrieval line", () => {
  const line = "QUJD".repeat(625); // 2500 characters of base64
  const r = elide(line);
  const [first, marker, ...rest] = r.text.split("\n");
  assert.deepEqual(rest, []);
  assert.equal(first, elidedLine(line.slice(0, 160), 2260, line.slice(-80)));
  const [, hash] = /^\[1 dense machine-generated line elided\. Retrieve original: hash=([0-9a-f]{12})\]$/.exec(marker) ?? [];
  assert.match(hash, HASH_RE);
  assert.equal(r.lines, 1);
  assert.deepEqual(r.offloaded, [[hash, line]]);
  /** @type {Map<string, string>} */
  const store = new Map();
  storeOffloaded(store, r.offloaded);
  assert.equal(store.get(hash), line);
});

test("elideDense passes short text, short lines and a small dense total through", () => {
  assert.equal(elideDense("x".repeat(299)), undefined);
  assert.equal(elideDense(Array.from({ length: 8 }, () => "x".repeat(299)).join("\n")), undefined); // 2392 characters, no line of 300
  assert.equal(elide(Array.from({ length: 8 }, () => "x".repeat(400)).join("\n")).lines, 8);
  assert.equal(elideDense(Array.from({ length: 6 }, () => "x".repeat(320)).join("\n")), undefined); // dense lines add up to 1920
});

test("elideDense leaves lines with a tab, 6% spaces, a JSON shape or a JSON document alone", () => {
  /**
   * A 1000-character line holding exactly `k` spaces.
   * @param {number} k
   */
  const spaced = (k) => ("x".repeat(15) + " ").repeat(k) + "x".repeat(1000 - 16 * k);
  assert.equal(elideDense(`${"x".repeat(1200)}\t${"x".repeat(1200)}`), undefined);
  assert.equal(elideDense([spaced(60), spaced(60), spaced(60)].join("\n")), undefined); // 60 / 1000 is the ratio that rejects
  assert.equal(elide([spaced(59), spaced(59), spaced(59)].join("\n")).lines, 3);
  assert.equal(elideDense(`[${"x".repeat(2500)}]`), undefined);
  assert.equal(elideDense(`  {${"x".repeat(2500)}}  `), undefined);
  assert.equal(elideDense(`data: {"a":1}${"x".repeat(2500)}`), undefined); // labelled JSON: only the SmartCrusher may touch it
  assert.equal(elide(`data: {"a":1${"x".repeat(2500)}`).lines, 1); // an unclosed brace holds no document
});

test("elideDense splits on newlines only, so a CRLF line keeps its carriage return", () => {
  const r = elide(`${"x".repeat(2500)}\r\nok\r\n`);
  const lines = r.text.split("\n");
  assert.ok(lines[0].endsWith(`${"x".repeat(79)}\r`), JSON.stringify(lines[0].slice(-4)));
  assert.equal(lines[1], "ok\r");
  assert.equal(lines[2], "");
  assert.match(lines[3], /^\[1 dense machine-generated line elided\. /);
});

test("elideDense passes a result that is not shorter through", () => {
  // Each 300-character line shrinks by one character; the retrieval line adds more than the seven save.
  assert.equal(elideDense(Array.from({ length: 7 }, () => "x".repeat(300)).join("\n")), undefined);
});

test("elideDense never cuts a surrogate pair in half", () => {
  const line = `${"x".repeat(159)}😀${"x".repeat(2400)}😀${"x".repeat(79)}`; // pairs straddle index 160 and length - 80
  const r = elide(line);
  const first = r.text.split("\n")[0];
  assert.equal(first, elidedLine("x".repeat(159), line.length - 159 - 79, "x".repeat(79)));
  assert.doesNotMatch(r.text, LONE_SURROGATE);
});

test("elideDense counts every dense line in the retrieval line", () => {
  const r = elide(`${"y".repeat(1200)}\nmiddle line\n${"z".repeat(1200)}`);
  assert.equal(r.lines, 2);
  assert.match(r.text, /\n\[2 dense machine-generated lines elided\. Retrieve original: hash=[0-9a-f]{12}\]$/);
  assert.equal(r.text.split("\n")[1], "middle line");
});

/** @typedef {import("../../plugins/inline-headroom/hooks/policy.mjs").DedupState} DedupState */

// Three numbered source lines of 40+ characters each: a run a pointer replaces.
const RUN = ["1:function alpha() { return computeAlpha(first); }", "2:function beta() { return computeBeta(second); }", "3:function gamma() { return computeGamma(third); }"].join("\n");

/**
 * dedupBlock on an unprotected text that must fold; throws otherwise.
 * @param {Map<string, DedupState>} states
 * @param {string} key
 * @param {string} text
 */
function fold(states, key, text) {
  const f = dedupBlock(states, key, text, false);
  if (!f) throw new Error("expected the text to fold");
  return f;
}

/** @returns {Map<string, DedupState>} a fresh set of conversations */
const conversations = () => new Map();

test("dedupBlock folds a repeated run of 3 lines and 40+ characters into a pointer to the earlier result", () => {
  const states = conversations();
  assert.equal(dedupBlock(states, "", RUN, false), undefined); // the first block never folds
  const f = fold(states, "", `intro\n${RUN}\noutro`);
  const [hash] = f.offloaded[0];
  assert.match(hash, /^[0-9a-f]{12}$/);
  assert.equal(f.text, `intro\n[↑3L same as result 1: "function alpha() ..." hash=${hash}]\noutro`);
  assert.equal(f.spans, 1);
  assert.deepEqual(f.offloaded, [[hash, RUN]]);
});

test("dedupBlock leaves 2 repeated lines and 3 lines under 40 characters alone", () => {
  const two = RUN.split("\n").slice(0, 2).join("\n");
  const states = conversations();
  dedupBlock(states, "", two, false);
  assert.equal(dedupBlock(states, "", two, false), undefined);
  const short = "1:abcd\n2:efgh\n3:ijkl"; // 20 characters
  const other = conversations();
  dedupBlock(other, "", short, false);
  assert.equal(dedupBlock(other, "", short, false), undefined);
});

test("dedupBlock never starts a run on a trivial line, but a run may hold one", () => {
  const text = ["return", "const alpha = computeAlphaValue(firstArgument);", "return", "const gamma = computeGammaValue(thirdArgument);"].join("\n");
  const states = conversations();
  dedupBlock(states, "", text, false);
  const f = fold(states, "", text);
  const [hash] = f.offloaded[0];
  assert.equal(f.text, `return\n[↑3L same as result 1: "const alpha = com..." hash=${hash}]`);
  assert.equal(f.offloaded[0][1], text.split("\n").slice(1).join("\n"));
});

test("dedupBlock folds a re-read whose line numbers all shifted, and timestamps with a leading zero only on an exact match", () => {
  /**
   * Three numbered lines starting at line `from`.
   * @param {number} from
   */
  const numbered = (from) => [`${from}:  const total = items.reduce((a, b) => a + b, 0);`, `${from + 1}:  const mean = total / items.length;`, `${from + 2}:  return { total, mean };`].join("\n");
  const states = conversations();
  dedupBlock(states, "", numbered(10), false);
  const f = fold(states, "", numbered(12));
  const [hash, run] = f.offloaded[0];
  assert.equal(f.text, `[↑3L same as result 1 +2L: "const total = ite..." hash=${hash}]`);
  assert.equal(run, numbered(12)); // the stored run is this block's own bytes
  /**
   * Three log lines at second `s` and on.
   * @param {number} s
   */
  const log = (s) => [0, 1, 2].map((k) => `08:00:${String(s + k).padStart(2, "0")} INFO request handled by worker ${k}`).join("\n");
  const logs = conversations();
  dedupBlock(logs, "", log(1), false);
  assert.equal(dedupBlock(logs, "", log(11), false), undefined); // "08" is no line number: no shifted fold
  assert.match(fold(logs, "", log(1)).text, /^\[↑3L same as result 1: "08:00:01 INFO req\.\.\." hash=[0-9a-f]{12}\]$/);
});

test("dedupBlock keeps the earliest original: a third repeat names result 1, not the folded result 2", () => {
  const states = conversations();
  dedupBlock(states, "", RUN, false);
  fold(states, "", RUN);
  assert.match(fold(states, "", RUN).text, /^\[↑3L same as result 1: /);
});

test("dedupBlock examines at most 16 anchor candidates per line", () => {
  const anchor = "const anchorLine = buildTheAnchorLine(withArguments);";
  const block = [anchor, "const second = buildTheSecondLine(withArguments);", "const third = buildTheThirdLine(withArguments);"].join("\n");
  const states = conversations();
  for (let i = 0; i < 16; i++) dedupBlock(states, "", anchor, false);
  assert.equal(dedupBlock(states, "", block, false), undefined);
  // Block 17's anchor line found its candidate list full, so an exact repeat of block 17 has no 3-line run to fold.
  assert.equal(dedupBlock(states, "", block, false), undefined);
});

test("dedupBlock keeps each conversation's corpus apart", () => {
  const states = conversations();
  dedupBlock(states, "", RUN, false);
  assert.equal(dedupBlock(states, "a1", RUN, false), undefined);
  assert.match(fold(states, "a1", RUN).text, /^\[↑3L same as result 1: /);
  assert.deepEqual([...states.keys()], ["", "a1"]);
});

test("dedupBlock never rewrites a protected text but folds a later text against it", () => {
  const states = conversations();
  assert.equal(dedupBlock(states, "", RUN, true), undefined);
  assert.equal(dedupBlock(states, "", RUN, true), undefined);
  assert.match(fold(states, "", RUN).text, /^\[↑3L same as result 1: /);
});

test("dedupBlock keeps a run whose pointer would not be shorter", () => {
  const run = "alpha line 01\nbravo line 02\ncharlie line 3"; // 42 characters: the pointer with its hash takes more
  const states = conversations();
  dedupBlock(states, "", run, false);
  assert.equal(dedupBlock(states, "", run, false), undefined);
});

test("dedupBlock is prefix-monotonic: an earlier block's output never depends on later blocks", () => {
  const lines = RUN.split("\n");
  const shifted = lines.map((l) => l.replace(/^(\d+):/, (_, n) => `${Number(n) + 5}:`)).join("\n");
  const blocks = [RUN, `header\n${RUN}`, shifted, `${lines[0]}\n${lines[1]}\nbetween\n${lines[2]}`, `${RUN}\ntail`];
  /**
   * Each block's output, fed in order to one fresh set of conversations.
   * @param {string[]} bs
   */
  const run = (bs) => {
    const states = conversations();
    return bs.map((b) => dedupBlock(states, "", b, false)?.text ?? b);
  };
  const full = run(blocks);
  assert.notDeepEqual(full, blocks);
  for (let k = 1; k <= blocks.length; k++) assert.deepEqual(run(blocks.slice(0, k)), full.slice(0, k));
});

test("dedupBlock empties the least recently appended conversation over DEDUP_MAX_CHARS and keeps its ordinals, and resets a lone one", () => {
  const half = "x".repeat(DEDUP_MAX_CHARS / 2 + 1);
  const states = conversations();
  dedupBlock(states, "a1", RUN, false); // a1's result 1
  dedupBlock(states, "a1", half, false); // a1's result 2
  dedupBlock(states, "", half, false);
  const a1 = /** @type {DedupState} */ (states.get("a1"));
  assert.deepEqual([a1.turn, a1.corpus.size, a1.index.size, a1.chars], [2, 0, 0, 0]); // emptied, not forgotten
  assert.equal(dedupBlock(states, "a1", RUN, false), undefined); // a1's result 3: results 1 and 2 left the corpus
  assert.match(fold(states, "a1", RUN).text, /^\[↑3L same as result 3: /); // never "result 1" again
  const solo = conversations();
  dedupBlock(solo, "", RUN, false); // result 1
  dedupBlock(solo, "", "y".repeat(DEDUP_MAX_CHARS + 1), false); // result 2, over the cap alone
  const st = /** @type {DedupState} */ (solo.get(""));
  assert.deepEqual([st.turn, st.corpus.size, st.index.size, st.chars], [2, 0, 0, 0]);
  assert.equal(dedupBlock(solo, "", RUN, false), undefined); // result 3: result 1 left the corpus
  assert.match(fold(solo, "", RUN).text, /^\[↑3L same as result 3: /);
});

test("resetCorpus empties a conversation's corpus but keeps its ordinals", () => {
  const states = conversations();
  dedupBlock(states, "", RUN, false); // result 1
  resetCorpus(/** @type {DedupState} */ (states.get("")));
  const st = /** @type {DedupState} */ (states.get(""));
  assert.deepEqual([st.turn, st.corpus.size, st.index.size, st.chars], [1, 0, 0, 0]);
  assert.equal(dedupBlock(states, "", RUN, false), undefined); // result 2: result 1 left the corpus
  assert.match(fold(states, "", RUN).text, /^\[↑3L same as result 2: /);
});

/** @typedef {import("../../plugins/inline-headroom/hooks/policy.mjs").ContentBlock} ContentBlock */
/** @typedef {import("../../plugins/inline-headroom/hooks/policy.mjs").Levers} Levers */

const IMAGE = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
// A pretty-printed document whose blob line is dense: elided when nothing crushes it, never once crushed.
const PRETTY = JSON.stringify({ rows: STATUS_ROWS, blob: "QUJD".repeat(700) }, null, 2);
// A dense line plus two short lines: elided to four lines (the omission note, both lines, the retrieval line).
const DENSE_TEXT = `${"x".repeat(2500)}\nexit code 0 after the bundle step\nfinished writing dist/app.min.js`;

/**
 * One tool_result block as session.append hands it.
 * @param {unknown} content
 * @param {boolean} [isError]
 * @returns {ContentBlock}
 */
const toolResult = (content, isError = false) => ({ type: "tool_result", tool_use_id: "toolu_1", content, ...(isError ? { is_error: true } : {}) });

/**
 * Every lever on, with a fresh main-loop dedup corpus unless one is given.
 * @param {Partial<Levers>} [over]
 * @returns {Levers}
 */
const levers = (over = {}) => ({ crush: true, elide: true, dedup: { states: new Map(), key: "" }, ...over });

/**
 * rewriteToolResults that must rewrite; throws when the row passes through.
 * @param {readonly ContentBlock[]} content
 * @param {string} tool
 * @param {Levers} lv
 */
function rewrite(content, tool, lv) {
  const r = rewriteToolResults(content, tool, lv, "");
  if (!r) throw new Error("expected the row to be rewritten");
  return r;
}

test("rewriteToolResults crushes a JSON string result and reports what it dropped and saved", () => {
  const r = rewrite([toolResult(BIG)], "Bash", levers());
  const text = String(r.content[0].content);
  const rows = JSON.parse(text);
  const [, hash, n] = SENTINEL.exec(rows.at(-1)._ccr_dropped) ?? [];
  assert.equal(r.crush.dropped, Number(n));
  assert.equal(r.crush.dropped, 200 - (rows.length - 1));
  assert.equal(r.crush.saved, BIG.length - text.length);
  assert.deepEqual(r.offloaded, [[hash, BIG]]);
  assert.deepEqual(
    [r.elide, r.dedup],
    [
      { lines: 0, saved: 0 },
      { spans: 0, saved: 0 },
    ],
  );
  assert.equal(r.content[0].tool_use_id, "toolu_1");
});

test("rewriteToolResults never rewrites an error block, but a later result folds against it", () => {
  const lv = levers();
  assert.equal(rewriteToolResults([toolResult(BIG, true)], "Bash", lv, ""), undefined);
  assert.equal(rewriteToolResults([toolResult(RUN, true)], "Bash", lv, ""), undefined);
  const r = rewrite([toolResult(RUN)], "Bash", lv);
  assert.match(String(r.content[0].content), /^\[↑3L same as result 2: "function alpha\(\) \.\.\." hash=[0-9a-f]{12}\]$/);
  assert.equal(r.dedup.spans, 1);
});

test("rewriteToolResults starts the conversation's corpus over when it throws midway, since the row is then stored as made", () => {
  const lv = levers();
  const boom = {
    type: "tool_result",
    tool_use_id: "toolu_2",
    get content() {
      throw new Error("boom");
    },
  };
  assert.throws(() => rewriteToolResults([toolResult(RUN), boom], "Bash", lv, ""), /boom/); // the first block was indexed before the throw
  assert.equal(rewriteToolResults([toolResult(RUN)], "Bash", lv, ""), undefined); // nothing to fold against
  assert.match(String(rewrite([toolResult(RUN)], "Bash", lv).content[0].content), /^\[↑3L same as result 2: /); // and the ordinals went on: result 1 was the half-indexed block
});

test("rewriteToolResults leaves headroom_retrieve and the mod's own storage tools alone", () => {
  // The retrieve tool by any name an engine may report: in full, bare, or under another server's namespace.
  for (const tool of [RETRIEVE_TOOL, "headroom_retrieve", "mcp__other__headroom_retrieve", "mcp__plugin_inline-headroom_storage__kv_get"]) {
    const lv = levers();
    assert.equal(rewriteToolResults([toolResult(BIG)], tool, lv, ""), undefined, tool);
    assert.equal(rewriteToolResults([toolResult(DENSE_TEXT)], tool, lv, ""), undefined, tool);
  }
});

test("rewriteToolResults rewrites only the text block of an array result", () => {
  const r = rewrite([toolResult([{ type: "text", text: BIG }, IMAGE])], "mcp__srv__list", levers());
  const [text, image] = /** @type {[{ type: string, text: string }, unknown]} */ (r.content[0].content);
  assert.equal(text.type, "text");
  assert.match(JSON.parse(text.text).at(-1)._ccr_dropped, SENTINEL);
  assert.equal(image, IMAGE);
});

test("rewriteToolResults never elides text the crusher rewrote, but elides it when the crusher is off", () => {
  const crushed = rewrite([toolResult(PRETTY)], "Bash", levers());
  assert.ok(crushed.crush.dropped > 0);
  assert.equal(crushed.elide.lines, 0);
  assert.equal(JSON.parse(String(crushed.content[0].content)).blob, "QUJD".repeat(700)); // still whole JSON
  const elided = rewrite([toolResult(PRETTY)], "Bash", levers({ crush: false }));
  assert.equal(elided.crush.dropped, 0);
  assert.equal(elided.elide.lines, 1);
  assert.match(String(elided.content[0].content), /\n\[1 dense machine-generated line elided\. Retrieve original: hash=[0-9a-f]{12}\]$/);
  assert.equal(rewriteToolResults([toolResult(BIG)], "Bash", levers({ crush: false }), ""), undefined); // one compact JSON line: nothing to elide or fold
});

test("rewriteToolResults deduplicates the elided text, not the original", () => {
  const lv = levers();
  const first = rewrite([toolResult(DENSE_TEXT)], "Bash", lv);
  const stored = String(first.content[0].content);
  assert.equal(first.elide.lines, 1);
  assert.equal(stored.split("\n").length, 4);
  const second = rewrite([toolResult(DENSE_TEXT)], "Bash", lv);
  const pointer = String(second.content[0].content);
  assert.match(pointer, /^\[↑4L same as result 1: "x{17}\.\.\." hash=[0-9a-f]{12}\]$/);
  assert.equal(second.dedup.spans, 1);
  assert.equal(second.dedup.saved, stored.length - pointer.length);
  assert.deepEqual(second.folded, [[pointer.slice(-13, -1), stored]]); // a dedup run goes to its own store, apart from the elider's original
  assert.equal(second.offloaded.length, 1);
});

test("rewriteToolResults neither deduplicates nor indexes a result with several text blocks", () => {
  const lv = levers();
  const multi = [
    toolResult([
      { type: "text", text: RUN },
      { type: "text", text: "a second text block" },
    ]),
  ];
  assert.equal(rewriteToolResults(multi, "Agent", lv, ""), undefined);
  assert.equal(rewriteToolResults(multi, "Agent", lv, ""), undefined);
  assert.equal(rewriteToolResults([toolResult(RUN)], "Bash", lv, ""), undefined); // nothing earlier was indexed
});

test("rewriteToolResults passes through rows with nothing to rewrite", () => {
  const lv = levers();
  assert.equal(rewriteToolResults([toolResult([{ type: "tool_reference", tool_name: "Read" }])], "ToolSearch", lv, ""), undefined);
  assert.equal(rewriteToolResults([toolResult("ok")], "Bash", lv, ""), undefined);
  assert.equal(rewriteToolResults([toolResult("")], "Bash", lv, ""), undefined);
  assert.equal(rewriteToolResults([{ type: "text", text: BIG }], "Bash", lv, ""), undefined); // not a tool_result block
  assert.equal(rewriteToolResults([toolResult(undefined)], "Bash", lv, ""), undefined);
});

test("rewriteToolResults with every lever off changes nothing", () => {
  const off = { crush: false, elide: false };
  assert.equal(rewriteToolResults([toolResult(BIG)], "Bash", off, ""), undefined);
  assert.equal(rewriteToolResults([toolResult(DENSE_TEXT)], "Bash", off, ""), undefined);
});

test("wantsQuery asks for the transcript only for a JSON document the crusher may rewrite", () => {
  assert.equal(wantsQuery([toolResult(BIG)], "Bash"), true);
  assert.equal(wantsQuery([toolResult([IMAGE, { type: "text", text: BIG }])], "mcp__srv__list"), true);
  assert.equal(wantsQuery([toolResult(BIG, true)], "Bash"), false);
  assert.equal(wantsQuery([toolResult(BIG)], RETRIEVE_TOOL), false);
  assert.equal(wantsQuery([toolResult(BIG)], "headroom_retrieve"), false);
  assert.equal(wantsQuery([toolResult(BIG)], "mcp__srv__my_headroom_retrieve"), true); // only the exact tool name, not a longer one ending in it
  assert.equal(wantsQuery([toolResult(BIG)], "mcp__plugin_inline-headroom_storage__kv_get"), false);
  assert.equal(wantsQuery([toolResult("[1,2,3]")], "Bash"), false);
  assert.equal(wantsQuery([toolResult("x".repeat(900))], "Bash"), false);
  // Text that merely starts with a bracket and is long never costs a transcript fetch: only a whole parsing document does.
  assert.equal(wantsQuery([toolResult("[ 10%] Building CXX object foo.o\n".repeat(40))], "Bash"), false);
  assert.equal(wantsQuery([toolResult("{" + "x".repeat(900))], "Bash"), false);
  assert.equal(wantsQuery([toolResult([{ type: "tool_reference", tool_name: "Read" }])], "ToolSearch"), false);
});

// Upstream tests/parity/fixtures/content_detector/*.json at 976aa71: [input, output.content_type], file name prefix.
/* eslint-disable max-len -- the fixture inputs are verbatim upstream strings */
const PARITY = [
  ["diff --combined merged.py\nindex aaa..bbb..ccc 100644\n--- a/merged.py\n+++ b/merged.py\n@@@ -1,4 -1,4 +1,5 @@@\n  unchanged\n- branch_a_only\n -branch_b_only\n++merge_added\n", "diff"], // 247811aecfdec556
  ['package com.example;\n\npublic class Foo {\n    @Override\n    public String toString() { return "foo"; }\n}\n\nprivate interface Bar {}\nprotected enum Baz { A, B }\n', "source_code"], // 37c86907c057e293
  ["Just some prose text without any structure or special markers.", "text"], // 3a0b14d2dea7c876
  ["<div>a</div>\n<span>b</span>\n<script>x()</script>\n<style>y</style>", "text"], // 3ba74a1f57c5351e
  ["", "text"], // 4efe946303371867
  ["import x from 'y';\nexport const foo = 1;\nfunction bar() { return 42; }\nconst f = async function() {};\nmodule.exports = { foo, bar };\n", "source_code"], // 53400da2b7dd2428
  ["diff --git a/foo.py b/foo.py\nindex abc..def 100644\n--- a/foo.py\n+++ b/foo.py\n@@ -1,3 +1,3 @@\n-old line\n+new line\n unchanged\n", "diff"], // 552d30c30c2a6793
  [
    'import os\nfrom typing import Any\n\n@dataclass\nclass Foo:\n    """Docstring."""\n    def bar(self):\n        return 42\n\ndef baz():\n    pass\n\nif __name__ == \'__main__\':\n    baz()\n',
    "source_code",
  ], // 5e8e1bc29f6c71c5
  ["INFO starting build\nWARN deprecated API used\nERROR compilation failed\nFAILED test_x\nPASSED test_y\n============================================\n", "build"], // 628c8985c40adb7d
  ["interface User { id: number; name: string; }\ntype Maybe<T> = T | null;\nenum Color { Red, Green, Blue }\nfunction f(x: number): boolean { return x > 0; }\n", "source_code"], // 67f4b1a1697c8aa9
  ["   \n\t  \n", "text"], // 70fbb444a583fe3c
  [
    "============================= test session starts ==============================\ntests/test_0.py::test_case PASSED\ntests/test_1.py::test_case PASSED\ntests/test_2.py::test_case PASSED\ntests/test_3.py::test_case PASSED\ntests/test_4.py::test_case PASSED\nFAILED tests/test_5.py::test_bad\nTraceback (most recent call last)\n",
    "build",
  ], // 71d648a39e151a72
  ["src/main.py:42:def process():\nsrc/util.py:13:    return None\nlib/x.py:7:class X:\ntests/test_a.py:3:    assert True", "search"], // 79e6b68a05a1c639
  ["<p>just one tag</p>", "text"], // 7e145153192c11a1
  ["[]", "json_array"], // 7fde660489bc47aa
  ['package main\n\nimport "fmt"\n\ntype Foo struct { ID int }\n\nfunc (f *Foo) Bar() int { return f.ID }\n\nfunc main() { fmt.Println("hi") }\n', "source_code"], // 837b272f1604eaaa
  // Rust's detector records "text" (arrays only); Python, which the port follows, reads any object as JSON.
  ['{"foo": "bar"}', "json_array"], // 9fb76321d31ed64c
  ['[{"id":1,"name":"a"},{"id":2,"name":"b"},{"id":3,"name":"c"}]', "json_array"], // bc4488ce189d1c86
  [
    "use std::collections::HashMap;\n\npub struct Foo { id: u32 }\n\nimpl Foo {\n    pub fn new() -> Self { Self { id: 0 } }\n}\n\nfn main() {}\n#[derive(Debug)]\nenum Color { Red, Green }\n",
    "source_code",
  ], // bf9b9ceb4b70dcd0
  ["[1, 2, 3, 4, 5]", "json_array"], // cabc55445af63e2f
  ["<!DOCTYPE html>\n<html>\n<head><title>x</title></head>\n<body><div><span>hi</span></div></body>\n</html>", "html"], // d100a9ac7a3671da
];
/* eslint-enable max-len */

test("detectContentType matches upstream's recorded parity fixtures, a JSON object aside", () => {
  assert.equal(PARITY.length, 21);
  for (const [input, tag] of PARITY) assert.equal(detectContentType(input), tag, JSON.stringify(input));
});

test("detectContentType reads JSON by parsing: objects, wrapped payloads and concatenated objects, never a bare scalar", () => {
  assert.equal(detectContentType('{"name": "x", "tags": ["a"]}'), "json_array");
  assert.equal(detectContentType(`Exit code: 0\n${JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: i })))}`), "json_array"); // a small wrapper, the array the bulk
  assert.equal(detectContentType('{"a":1} {"b":2}'), "json_array");
  assert.notEqual(detectContentType('The service answered {"ok": true} after a retry that took several seconds to complete'), "json_array"); // under 60% of the text
  assert.equal(detectContentType("42"), "text");
  assert.notEqual(detectContentType('{"a":1} trailing prose that is much longer than the object itself'), "json_array");
});

test("detectContentType never throws on deeply nested brackets", () => {
  assert.doesNotThrow(() => detectContentType("[".repeat(100_000) + "]".repeat(100_000)));
});

test("detectContentType counts a lone diff header as a diff and reads only the first 500 lines", () => {
  assert.equal(detectContentType("diff --git a/x b/x\n"), "diff"); // 0.5 + 0.2 is exactly the 0.7 gate
  assert.equal(detectContentType("plain\n".repeat(500) + "diff --git a/x b/x\n+y"), "text");
});

test("detectContentType needs real HTML signals", () => {
  assert.notEqual(detectContentType("<div>hello</div>"), "html");
  assert.equal(detectContentType("<!DOCTYPE html>\n<html>\n<body><p>hi</p></body>\n</html>"), "html");
});

test("detectContentType recognizes git status only with a heading and a path entry", () => {
  const full = [
    "On branch feature/status",
    "Changes to be committed:",
    '  (use "git restore --staged <file>..." to unstage)',
    "\tnew file:   staged file.txt",
    "",
    "Changes not staged for commit:",
    '  (use "git add <file>..." to update what will be committed)',
    "\tmodified:   path with spaces.txt",
    "",
    "Untracked files:",
    '  (use "git add <file>..." to include in what will be committed)',
    "\tuntracked path.txt",
    "",
  ].join("\n");
  assert.equal(detectContentType(full), "tabular");
  const untracked = [
    "On branch feature/status",
    "",
    "Untracked files:",
    '  (use "git add <file>..." to include in what will be committed)',
    "\tuntracked path with spaces.txt",
    "\tuntracked α.rs",
    "",
  ].join("\n");
  assert.equal(detectContentType(untracked), "tabular");
  assert.notEqual(detectContentType("The branch has many changes:\n- modified: item one\n- modified: item two"), "tabular");
  assert.equal(detectContentType("On branch main\r\nUntracked files:\r\n\tfoo\r\n"), "tabular"); // splitlines() splits on CRLF too
});

test("detectContentType wants two grep lines, rejects timestamped log rows and takes grep context lines", () => {
  assert.equal(detectContentType("src/a.py:12:def main():\nThis is an explanation of what the function does."), "text");
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const timestamped = Array.from({ length: 200 }, (_, i) => `2026-09-23T10:${pad(Math.floor(i / 60))}:${pad(i % 60)}Z INFO worker[${i % 8}] processed batch ${i} in ${(i * 13) % 900}ms`).join("\n");
  assert.notEqual(detectContentType(timestamped), "search");
  assert.equal(detectContentType("src/a.py-12-foo\nsrc/a.py:13:bar\nsrc/a.py-14-baz"), "search");
  assert.notEqual(detectContentType("2026-09-14-release notes\n2026-09-15-release notes\nplain line"), "search"); // a date is no path
});

test("detectContentType reads CMTrace records as build output", () => {
  const attrs = (/** @type {number} */ sec) =>
    `time="10:00:${String(sec).padStart(2, "0")}.000-0" date="01-15-2026" component="ExampleCorp_SampleApp_1.0.0_x64_B1" context="SYSTEM" type="1" thread="4242" file="install.ps1"`;
  const record = (/** @type {string} */ message, /** @type {number} */ sec) => `<![LOG[${message}]LOG]!><${attrs(sec)}>`;
  const messages = [
    "Starting deployment of SampleApp 1.0.0",
    "Detection rule evaluated, not installed",
    "Downloading package from content source",
    "Extracting files to target directory",
    "Registering application components",
    "Starting service SampleAppSvc",
    "Writing uninstall registry entries",
    "Deployment completed with exit code 0",
  ];
  const records = messages.flatMap((m, i) => [record("=".repeat(75), i * 2), record(m, i * 2 + 1)]);
  assert.equal(detectContentType(records.join("\n")), "build");
  assert.equal(detectContentType(records.join("")), "build"); // run together, as Intune writes them
  assert.equal(detectContentType(record(messages[0], 1)), "build");
  const divider = record("=".repeat(75), 0);
  assert.notEqual(detectContentType(`${divider}\n${divider}`), "search"); // the path-shape guard rejects its "<" prefix
});

test("detectContentType knows C# and PHP", () => {
  assert.equal(detectContentType("using System;\nusing System.Linq;\nnamespace Foo\npublic class Bar\n{ get; set; }"), "source_code");
  assert.equal(detectContentType("<?php\nnamespace App\\Models;\nuse Foo\\Bar;\nfunction x() {"), "source_code");
});

test("detectContentType cuts each sampled line, so a backtracking pattern cannot stall the append hook", () => {
  const t0 = Date.now();
  detectContentType(`${" ".repeat(200_000)}\nok`); // the PHP function pattern backtracks quadratically on leading whitespace
  detectContentType(`at ${") in ".repeat(40_000)}`); // so does the C# stack-trace pattern
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  // A signal inside the first DETECT_MAX_LINE_CHARS still counts.
  assert.equal(detectContentType(`ERROR boom ${"x".repeat(5000)}\nFAIL again`), "build");
});

test("rewriteToolResults crushes only JSON and elides a dense line of every other content type", () => {
  const D = "x".repeat(2500);
  /** @type {[string, string][]} */
  const samples = [
    ["search", `src/a.py:1:${D}\nsrc/b.py:2:foo`],
    ["build", `ERROR build failed\n${D}`],
    ["source_code", `import os\nimport sys\ndef main():\n${D}`],
    ["diff", `diff --git a/x b/x\n+${D}`],
    ["html", `<!DOCTYPE html>\n<html>\n${D}`],
    ["tabular", `On branch main\nUntracked files:\n\tfoo\n${D}`],
    ["text", DENSE_TEXT],
    ["json_array", JSON.stringify({ blob: "QUJD".repeat(700) }, null, 2)], // no array to drop: the crusher declines, the elider still runs
  ];
  for (const [tag, sample] of samples) {
    assert.equal(detectContentType(sample), tag);
    const r = rewrite([toolResult(sample)], "Bash", levers());
    assert.equal(r.elide.lines, 1, tag);
    assert.equal(r.crush.dropped, 0, tag);
  }
});

// Lossless compaction (upstream compaction/compactor.rs, formatter.rs and crusher.rs's lossless-first stage).

/**
 * The compaction as a table; throws when it is not one.
 * @param {import("../../plugins/inline-headroom/hooks/policy.mjs").Compaction} c
 */
function asTable(c) {
  if (c.kind !== "table") throw new Error(`expected a table, got ${c.kind}`);
  return c;
}

/**
 * Upstream csv_quote, for building expected cells.
 * @param {string} s
 */
const csvq = (s) => `"${s.replaceAll('"', '""')}"`;

/** The lossless stage alone (upstream lossless_only). */
const LOSSLESS_ONLY = { lossy: false, lossless: true };
/** Both stages, lossless first (upstream SmartCrusher::new). */
const BOTH = { lossy: true, lossless: true };

/**
 * crushJson with explicit stages that must rewrite; throws when the text passes through.
 * @param {string} text
 * @param {import("../../plugins/inline-headroom/hooks/policy.mjs").CrushModes} modes
 */
function crushWith(text, modes) {
  const r = crushJson(text, "", modes);
  if (!r) throw new Error("expected crushJson to rewrite the document");
  return r;
}

test("compactRows leaves fewer than 2 items and non-object items untouched", () => {
  assert.equal(compactRows([]).kind, "untouched");
  assert.equal(compactRows([{ a: 1 }]).kind, "untouched");
  assert.equal(compactRows([1, 2, 3]).kind, "untouched");
  assert.equal(compactRows([{ a: 1 }, 2]).kind, "untouched");
});

test("compactRows renders a uniform array as a typed schema line and CSV rows", () => {
  const items = [
    { id: 1, name: "alice", status: "ok" },
    { id: 2, name: "bob", status: "ok" },
    { id: 3, name: "carol", status: "fail" },
  ];
  assert.equal(formatCsvSchema(compactRows(items)), "[3]{id:int,name:string,status:string}\n1,alice,ok\n2,bob,ok\n3,carol,fail\n");
  assert.equal(formatCsvSchema(compactRows([{ x: 1.5 }, { x: true }])), "[2]{x:json}\n1.5\ntrue\n"); // a type conflict is json
});

test("compactRows flattens a uniform nested object into dotted columns and keeps mixed ones nested", () => {
  const uniform = [
    { id: 1, meta: { region: "us", tier: "gold" } },
    { id: 2, meta: { region: "eu", tier: "silver" } },
    { id: 3, meta: { region: "us", tier: "bronze" } },
  ];
  assert.equal(formatCsvSchema(compactRows(uniform)), "[3]{id:int,meta.region:string,meta.tier:string}\n1,us,gold\n2,eu,silver\n3,us,bronze\n");
  const mixed = [
    { id: 1, meta: { region: "us" } },
    { id: 2, meta: { region: "eu", tier: "silver" } },
    { id: 3, meta: { tier: "bronze" } },
  ];
  const t = asTable(compactRows(mixed));
  assert.deepEqual(
    t.fields.map((f) => f.name),
    ["id", "meta"],
  );
  assert.equal(formatCsvSchema(t).split("\n")[1], `1,${csvq('{"region":"us"}')}`);
  // A header-breaking inner key keeps its column nested instead of naming a column after it.
  assert.deepEqual(
    asTable(compactRows([{ m: { "a,b": 1 } }, { m: { "a,b": 2 } }])).fields.map((f) => f.name),
    ["m"],
  );
});

test("compactRows nests a stringified array of objects and an array cell as quoted compaction JSON", () => {
  const items = [
    { event: "batch", payload: '[{"x":1},{"x":2},{"x":3}]' },
    { event: "batch", payload: '[{"x":4},{"x":5}]' },
  ];
  const lines = formatCsvSchema(compactRows(items)).split("\n");
  assert.equal(lines[0], "[2]{event:string,payload:string}");
  assert.equal(lines[1], `batch,${csvq(JSON.stringify({ _compaction: "table", _schema: [{ name: "x", type: "int" }], _kept: 3, _total: 3, _rows: [[1], [2], [3]] }))}`);
  const nested = formatCsvSchema(
    compactRows([
      { id: 1, items: [{ x: 1 }, { x: null }] },
      { id: 2, items: [{ x: 3 }, { y: 4 }] },
    ]),
  ).split("\n");
  assert.equal(nested[0], "[2]{id:int,items:json}");
  assert.equal(nested[1], `1,${csvq(JSON.stringify({ _compaction: "table", _schema: [{ name: "x", type: "int", nullable: true }], _kept: 2, _total: 2, _rows: [[1], [null]] }))}`);
  // A stringified object becomes its parsed value; a string carrying a CCR marker is never parsed.
  assert.equal(formatCsvSchema(compactRows([{ v: '{"a":1}' }, { v: "<<ccr:abc [1]>>" }])), `[2]{v:string}\n${csvq('{"a":1}')}\n<<ccr:abc [1]>>\n`);
});

test("compactRows keeps a stringified value JSON.parse would change as a string", () => {
  const out = formatCsvSchema(compactRows([{ v: '{"n":12345678901234567890}' }, { v: '{"n":1}' }]));
  assert.equal(out.split("\n")[1], csvq('{"n":12345678901234567890}'));
});

test("compactRows buckets a heterogeneous array by its discriminator and skips an id-like one", () => {
  const items = [
    { type: "user", id: 1, name: "alice" },
    { type: "user", id: 2, name: "bob" },
    { type: "order", id: 99, total: 50 },
    { type: "order", id: 100, total: 75 },
  ];
  assert.equal(
    formatCsvSchema(compactRows(items)),
    "__buckets:type\n__key:order\n[2]{id:int,total:int,type:string}\n99,50,order\n100,75,order\n__key:user\n[2]{id:int,name:string,type:string}\n1,alice,user\n2,bob,user\n",
  );
  const c = compactRows([
    { id: "a1", kind: "x", p: 1 },
    { id: "a2", kind: "x", q: 1 },
    { id: "a3", kind: "y", r: 1 },
    { id: "a4", kind: "y", s: 1 },
  ]);
  assert.equal(c.kind === "buckets" ? c.disc : c.kind, "kind"); // "id" is unique per row: an id, not a category
});

test("compactRows orders columns by frequency then name and marks sparse or null columns nullable", () => {
  assert.equal(formatCsvSchema(compactRows([{ common: 1, z_rare: 1 }, { common: 2, a_rare: 1 }, { common: 3 }])), "[3]{common:int,a_rare:int?,z_rare:int?}\n1,,1\n2,1,\n3,,\n");
  assert.equal(formatCsvSchema(compactRows([{ id: 1, tag: "a" }, { id: 2 }, { id: 3, tag: null }])), "[3]{id:int,tag:string?}\n1,a\n2,\n3,null\n");
});

test("formatCsvSchema tells a missing key, null, an empty string and the string null apart, and quotes CSV specials", () => {
  assert.equal(formatCsvSchema(compactRows([{ id: 1 }, { id: 2, label: null }, { id: 3, label: "" }, { id: 4, label: "null" }])), '[4]{id:int,label:string?}\n1,\n2,null\n3,""\n4,"null"\n');
  assert.equal(
    formatCsvSchema(
      compactRows([
        { id: 1, msg: "alice, the great" },
        { id: 2, msg: 'she said "hi"' },
        { id: 3, msg: "a\nb" },
        { id: 4, msg: "c\rd" },
      ]),
    ),
    '[4]{id:int,msg:string}\n1,"alice, the great"\n2,"she said ""hi"""\n3,"a\nb"\n4,"c\rd"\n',
  );
});

test("formatCsvSchema quotes a json column's strings that JSON would read as a value", () => {
  const items = [
    { id: 1, v: "null" },
    { id: 2, v: null },
    { id: 3, v: "true" },
    { id: 4, v: true },
    { id: 5, v: "1" },
    { id: 6, v: 1 },
    { id: 7, v: "hello" },
  ];
  assert.deepEqual(formatCsvSchema(compactRows(items)).split("\n"), ["[7]{id:int,v:json?}", '1,"""null"""', "2,null", '3,"""true"""', "4,true", '5,"""1"""', "6,1", "7,hello", ""]);
});

test("compactionJson renders tables and buckets in upstream key order", () => {
  assert.deepEqual(compactionJson(compactRows([{ a: 1 }, { b: "x" }])), {
    _compaction: "table",
    _schema: [
      { name: "a", type: "int", nullable: true },
      { name: "b", type: "string", nullable: true },
    ],
    _kept: 2,
    _total: 2,
    _rows: [
      [1, null],
      [null, "x"],
    ],
  });
  const buckets = compactRows([
    { k: "a", p: 1 },
    { k: "a", q: 2 },
    { k: "b", r: 3 },
    { k: "b", s: 4 },
  ]);
  assert.ok(JSON.stringify(compactionJson(buckets)).startsWith('{"_compaction":"buckets","_discriminator":"k","_total":4,"_buckets":[{"_key":"a","_schema":'));
  assert.deepEqual(compactionJson({ kind: "untouched", value: [1, 2] }), [1, 2]);
});

test("compactRows refuses a header-breaking key and finds a discriminator among many sparse keys in linear work", () => {
  for (const key of ["a,b", "a:b", "a{b", "a}b", "a?b", "a\nb", "a\rb"]) assert.equal(compactRows([{ [key]: 1 }, { [key]: 2 }]).kind, "untouched", JSON.stringify(key));
  const sparse = Array.from({ length: 600 }, (_, i) => ({
    kind: i % 2 ? "odd" : "even",
    [`k${i}`]: i,
  }));
  const c = compactRows(sparse);
  assert.equal(c.kind === "buckets" ? c.disc : c.kind, "kind");
  // 20,000 distinct keys: a budget of 4 per input character + 4096 stops the two 10,000 × 10,001 sparse tables before they are built.
  const huge = Array.from({ length: 20_000 }, (_, i) => ({
    kind: i % 2 ? "odd" : "even",
    [`k${i}`]: i,
  }));
  const budget = { left: 4 * JSON.stringify(huge).length + 4096 };
  const t0 = Date.now();
  compactRows(huge, budget);
  assert.ok(budget.left < 0);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  assert.equal(crushJson(JSON.stringify(huge.slice(0, 4000)), "", LOSSLESS_ONLY), undefined); // crushDictArray then declines
});

/**
 * `n` one-key rows whose string values are `len` characters long (unique per row).
 * @param {number} n
 * @param {number} len
 */
const oneKeyRows = (n, len) =>
  JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      a: `${"v".repeat(len - 3)}${String(i).padStart(3, "0")}`,
    })),
  );

test("lossless compaction keeps the 15% savings gate and runs only above K rows", () => {
  // 20 rows, a one-character key: the table saves 146 / (181 + 20 × len) of the array, 15.2% at 39 and 14.9% at 40.
  assert.ok(String(JSON.parse(crushWith(oneKeyRows(20, 39), LOSSLESS_ONLY).text)).startsWith("[20]{a:string}\n"));
  assert.equal(crushJson(oneKeyRows(20, 40), "", LOSSLESS_ONLY), undefined);
  // 8 rows are within K whatever they hold: no table, no drop.
  const eight = JSON.stringify(
    Array.from({ length: 8 }, (_, i) => ({
      a_rather_long_column_name: i,
      another_rather_long_column_name: "same value",
      third_long_column_name: true,
    })),
  );
  assert.ok(eight.length > CRUSH_MIN_CHARS);
  assert.equal(crushJson(eight, "", LOSSLESS_ONLY), undefined);
});

test("crushJson's lossless-only mode drops nothing and keeps an array that does not compact whole", () => {
  const loose = JSON.parse(oneKeyRows(20, 40));
  const r = crushWith(JSON.stringify({ tight: STATUS_ROWS, loose }), LOSSLESS_ONLY);
  const out = JSON.parse(r.text);
  assert.ok(String(out.tight).startsWith("[200]{id:int,note:string,status:string}\n"));
  assert.deepEqual(out.loose, loose);
  assert.deepEqual([r.rowsDropped, r.compacted, r.offloaded], [0, 1, []]);
});

test("crushJson renders a top-level array as a JSON string literal and counts the table's savings", () => {
  const r = crushWith(BIG, BOTH);
  const table = JSON.parse(r.text);
  assert.equal(typeof table, "string");
  assert.ok(table.startsWith("[200]{id:int,note:string,status:string}\n0,same text,ok\n"));
  assert.ok(table.split("\n").includes("150,same text,error"));
  assert.equal(table.split("\n").length, 202); // the schema line, 200 rows, the final newline
  assert.deepEqual([r.rowsDropped, r.compacted, r.compactSaved, r.offloaded], [0, 1, BIG.length - r.text.length, []]);
});

test("crushJson uses a nested stringified array's table as the field's string, never double-encoded", () => {
  const r = crushWith(JSON.stringify({ payload: JSON.stringify(STATUS_ROWS) }), BOTH);
  assert.ok(JSON.parse(r.text).payload.startsWith("[200]{id:int,note:string,status:string}\n"));
});

test("rewriteToolResults books a lossless table under compaction, not the crusher", () => {
  const r = rewrite([toolResult(BIG)], "Bash", levers({ compact: true }));
  const text = String(r.content[0].content);
  assert.ok(String(JSON.parse(text)).startsWith("[200]{"));
  assert.deepEqual(r.compact, { arrays: 1, saved: BIG.length - text.length });
  assert.deepEqual(r.crush, { dropped: 0, saved: 0 });
  assert.deepEqual(r.offloaded, []);
  // The crusher off and compaction on is upstream's lossless_only: still a table, and an array that does not compact stays whole.
  assert.equal(rewrite([toolResult(BIG)], "Bash", levers({ crush: false, compact: true })).content[0].content, text);
  assert.equal(rewriteToolResults([toolResult(oneKeyRows(20, 40))], "Bash", levers({ crush: false, compact: true }), ""), undefined);
});
