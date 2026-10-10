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
  crushJson,
  crushQuery,
  crushToolResult,
  dayKey,
  findVolatile,
  foldPending,
  isCacheDrop,
  isCrushCandidate,
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

test("crushJson minifies pretty JSON whose arrays all stay within K, dropping nothing", () => {
  const doc = { groups: Array.from({ length: 6 }, (_, g) => ({ name: `group ${g}`, rows: Array.from({ length: 8 }, (_, i) => ({ id: i, note: "kept as is" })) })) };
  const r = crushText(JSON.stringify(doc, null, 2));
  assert.equal(r.text, JSON.stringify(doc));
  assert.equal(r.rowsDropped, 0);
  assert.deepEqual(r.offloaded, []);
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

test("crushJson keeps a row the query names that an empty query drops", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: 48200 + i, title: `row ${i} alpha beta gamma`, status: i === 5 ? "failed" : "ok" }));
  assert.ok(!keptIds(crush(rows).out).includes(48213));
  assert.ok(keptIds(crush(rows, "show me 48213").out).includes(48213));
});

test("crushJson never samples unique entities without a signal", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, title: `Gardening tip number ${String(i).padStart(3, "0")} for spring beds` }));
  const r = crushText(JSON.stringify(rows, null, 2)); // minified only
  assert.equal(r.rowsDropped, 0);
  assert.ok(!r.text.includes("_ccr_dropped"));
  assert.deepEqual(r.out, rows);
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

const BIG = JSON.stringify(STATUS_ROWS);

/**
 * crushToolResult with an empty query; throws when the result is not rewritten.
 * @param {string} tool
 * @param {unknown} result
 */
function crushTool(tool, result) {
  const c = crushToolResult(tool, result, "");
  if (!c) throw new Error(`expected the ${tool} result to be crushed`);
  return c;
}

test("crushToolResult rewrites a candidate Bash result's stdout and nothing else", () => {
  const result = { stdout: BIG, stderr: "", interrupted: false, noOutputExpected: false };
  assert.equal(isCrushCandidate("Bash", result), true);
  const c = crushTool("Bash", result);
  const { stdout, ...rest } = c.result;
  assert.deepEqual(rest, { stderr: "", interrupted: false, noOutputExpected: false });
  assert.equal(typeof stdout, "string");
  const rows = JSON.parse(String(stdout));
  assert.match(rows.at(-1)._ccr_dropped, SENTINEL);
  assert.equal(c.rowsDropped, 200 - (rows.length - 1));
  assert.equal(c.charsSaved, BIG.length - String(stdout).length);
  assert.equal(c.offloaded.length, 1);
  assert.equal(result.stdout, BIG); // the input is not mutated
});

test("Bash results that are not one whole inline JSON document are never candidates", () => {
  const ok = { stdout: BIG, stderr: "", interrupted: false };
  for (const extra of [
    { interrupted: true },
    { isImage: true },
    { backgroundTaskId: "b1" },
    { timedOutAfterMs: 120000 },
    { persistedOutputPath: "/tmp/out.txt" },
    { rawOutputPath: "/tmp/raw.txt" },
    { stderr: "warn" },
    { structuredContent: [{ type: "text", text: "x" }] },
    { stdout: "x".repeat(900) },
    { stdout: "[ 10%] Building CXX object foo.o\n".repeat(40) }, // starts with "[" but is a build log
    { stdout: "{" + "x".repeat(900) }, // starts with "{" but does not parse
  ]) {
    assert.equal(isCrushCandidate("Bash", { ...ok, ...extra }), false, Object.keys(extra)[0]);
    assert.equal(crushToolResult("Bash", { ...ok, ...extra }, ""), undefined, Object.keys(extra)[0]);
  }
});

test("crushToolResult rewrites only an MCP result's JSON text blocks", () => {
  const image = { type: "image", data: "x", mimeType: "image/png" };
  const small = { type: "text", text: "[1,2,3]" };
  const json = { type: "text", text: BIG };
  const result = { content: [json, image, small], isError: false };
  const c = crushTool("mcp__srv__list", result);
  const content = /** @type {{ text?: string }[]} */ (c.result.content);
  assert.equal(c.result.isError, false);
  assert.match(JSON.parse(String(content[0].text)).at(-1)._ccr_dropped, SENTINEL);
  assert.equal(content[1], image);
  assert.equal(content[2], small);
  assert.equal(json.text, BIG); // the input is not mutated
});

test("MCP errors, structured results, headroom_retrieve, the mod's storage tools and built-ins are never candidates", () => {
  const result = { content: [{ type: "text", text: BIG }] };
  assert.equal(isCrushCandidate("mcp__srv__list", result), true);
  for (const [tool, r] of /** @type {[string, unknown][]} */ ([
    ["mcp__srv__list", { ...result, structuredContent: { rows: [] } }],
    ["mcp__srv__list", { ...result, isError: true }],
    [RETRIEVE_TOOL, result],
    ["mcp__plugin_inline-headroom_storage__kv_get", result],
    ["Read", result],
    ["mcp__srv__list", { content: BIG }],
  ])) {
    assert.equal(isCrushCandidate(tool, r), false, tool);
    assert.equal(crushToolResult(tool, r, ""), undefined, tool);
  }
});
