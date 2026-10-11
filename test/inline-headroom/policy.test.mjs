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
  bm25Scores,
  cacheHitRatio,
  clampEffort,
  collapseRuns,
  compactConfigLossless,
  compactRows,
  compactionJson,
  compressLog,
  compressSearch,
  compressConfig,
  compressDiff,
  computeOptimalK,
  configFlavor,
  crushJson,
  crushNumberArray,
  crushQuery,
  crushStringArray,
  crushText as crushProse,
  dayKey,
  detectContentType,
  dedupBlock,
  elideDense,
  expandRuns,
  extractHtml,
  findVolatile,
  foldRepeatedBlocks,
  foldLog,
  foldDiff,
  foldPending,
  foldSearch,
  foldText,
  formatCsvSchema,
  isCacheDrop,
  isIniAssign,
  isOwnStorageCall,
  isToolError,
  numberChangePoints,
  relevanceScores,
  resetCorpus,
  retrieveKey,
  rewriteToolResults,
  roundHalfEven,
  statsTables,
  stepEffort,
  storeOffloaded,
  tableText,
  tagSpans,
  toCount,
  unfoldRepeatedBlocks,
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
    [
      ["config", "texts", "saved"],
      ["session", "0", "0"],
    ],
    [
      ["html extractor", "pages", "saved"],
      ["session", "0", "0"],
    ],
    [
      ["logs", "texts", "saved"],
      ["session", "0", "0"],
    ],
    [
      ["search", "texts", "saved"],
      ["session", "0", "0"],
    ],
    [
      ["diff", "texts", "saved"],
      ["session", "0", "0"],
    ],
    [
      ["text crusher", "texts", "saved"],
      ["session", "0", "0"],
    ],
    [
      ["relevance split", "texts", "saved"],
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
  const [, , , , , compactor, configs, extractor] = statsTables([c], "…", { compact: { arrays: 2, saved: 5300 }, config: { texts: 1, saved: 640 }, extract: { pages: 3, saved: 21000 } });
  assert.deepEqual(compactor[1], ["session", "2", "5300"]);
  assert.deepEqual(configs[1], ["session", "1", "640"]);
  assert.deepEqual(extractor[1], ["session", "3", "21000"]);
  const [, , , , , , , , logs, searches, diffs, crushedTexts, splits] = statsTables([c], "…", {
    log: { texts: 1, saved: 900 },
    search: { texts: 2, saved: 1800 },
    diff: { texts: 3, saved: 2700 },
    textcrush: { texts: 4, saved: 3600 },
    split: { texts: 5, saved: 4500 },
  });
  assert.deepEqual(
    [logs, searches, diffs, crushedTexts, splits].map((t) => [t[0][0], ...t[1].slice(1)]),
    [
      ["logs", "1", "900"],
      ["search", "2", "1800"],
      ["diff", "3", "2700"],
      ["text crusher", "4", "3600"],
      ["relevance split", "5", "4500"],
    ],
  );
  // Every heading fits the label column.
  for (const t of statsTables([c], "…")) assert.ok(t[0][0].length <= 16, t[0][0]);
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

test("computeOptimalK honours a caller's minK and maxK and answers maxK once its simhash budget runs out", () => {
  const items = Array.from({ length: 20 }, (_, i) => `unique item number ${i} with some long content`);
  assert.equal(computeOptimalK(items, 10, 100), 19); // the crusher's cap of 15 no longer binds
  assert.equal(computeOptimalK(items, 5, 30, { left: 1e9 }), 19); // a budget that suffices changes nothing
  assert.equal(computeOptimalK(items, 5, 30, { left: 0 }), 30);
  assert.equal(
    computeOptimalK(
      Array.from({ length: 30 }, () => "abc"),
      10,
      100,
    ),
    10,
  ); // redundant rows: minK
  assert.equal(computeOptimalK(["a", "b", "c"], 1, 2), 3); // 8 or fewer keep every item, even above maxK (upstream's fast path)
});

// Captured from relevanceScores before its BM25 core moved into bm25Batch: the refactor must not move a single bit.
const SCORED_ROWS = [
  '{"id":1,"host":"alpha.example.com","status":"ok","note":"nightly backup finished"}',
  '{"id":2,"host":"beta.example.com","status":"error","note":"connection refused by upstream"}',
  '{"id":3,"host":"gamma.example.com","status":"ok","note":"nightly backup finished"}',
  '{"id":4,"host":"delta.example.com","status":"ok","note":"retrying connection after timeout"}',
  '{"id":5,"host":"epsilon.example.com","status":"ok","note":"configuration reloaded"}',
];

test("relevanceScores keeps its selective filter, 8-char bonus, 0.3 floor and +0.2 boost bit for bit", () => {
  assert.deepEqual(relevanceScores(SCORED_ROWS, "connection refused beta"), [0, 0.701983971405207, 0, 0.3673279904684023, 0]);
  assert.deepEqual(relevanceScores(SCORED_ROWS, "status example host"), [0, 0, 0, 0, 0]); // every term in more than half the rows
  assert.deepEqual(relevanceScores(SCORED_ROWS, "configuration"), [0, 0, 0, 0, 0.3725248336434934]); // 8+ chars: +0.3
  assert.deepEqual(relevanceScores(SCORED_ROWS, "nightly backup"), [0.5, 0, 0.5, 0, 0]); // floor 0.3, two matches +0.2
  assert.deepEqual(relevanceScores(SCORED_ROWS, "refused"), [0, 0.3, 0, 0, 0]); // floor alone
  assert.deepEqual(relevanceScores(SCORED_ROWS, ""), [0, 0, 0, 0, 0]);
  assert.deepEqual(relevanceScores(SCORED_ROWS, "unrelated words only"), [0, 0, 0, 0, 0]);
});

test("bm25Scores is upstream BM25Scorer.score_batch: ln 2 idf, k1 1.5, b 0.75, over 10, +0.3 for an 8-char match", () => {
  // Tokens [alpha beta], [beta gamma gamma], [delta]: average length 2.
  const [a, b, c] = bm25Scores(["alpha beta", "beta gamma gamma", "delta"], "gamma beta");
  const term = (/** @type {number} */ f, /** @type {number} */ len) => (Math.LN2 * f * 2.5) / (f + 1.5 * (0.25 + (0.75 * len) / 2));
  assert.ok(Math.abs(a - term(1, 2) / 10) < 1e-12, String(a));
  assert.ok(Math.abs(b - (term(1, 3) + term(2, 3)) / 10) < 1e-12, String(b));
  assert.equal(c, 0);
  // Average length 1.5; "configuration" has 13 chars: +0.3, and no selective filter or floor applies.
  const [d, e] = bm25Scores(["configuration file", "other"], "configuration");
  assert.ok(Math.abs(d - ((Math.LN2 * 2.5) / (1 + 1.5 * (0.25 + (0.75 * 2) / 1.5)) / 10 + 0.3)) < 1e-12, String(d));
  assert.equal(e, 0);
  assert.deepEqual(bm25Scores(["alpha", "beta"], ""), [0, 0]);
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

test("rewriteToolResults never folds a Read result, but a later result folds against it", () => {
  const lv = levers();
  assert.equal(rewriteToolResults([toolResult(RUN)], "Read", lv, ""), undefined);
  assert.equal(rewriteToolResults([toolResult(RUN)], "Read", lv, ""), undefined); // a re-Read stays verbatim for the next Edit
  const r = rewrite([toolResult(RUN)], "Bash", lv);
  assert.match(String(r.content[0].content), /^\[↑3L same as result 1: /);
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

test("the router still ends every route with the elider when the new levers find nothing to do", () => {
  const smallDiff = `diff --git a/app.min.js b/app.min.js\n@@ -1,1 +1,1 @@\n-${"x".repeat(2500)}\n+${"y".repeat(2500)}`;
  assert.equal(detectContentType(smallDiff), "diff");
  const all = { crush: false, elide: true, log: true, search: true, diff: true, textcrush: true, split: true };
  for (const text of [DENSE_TEXT, smallDiff]) {
    const elideOnly = rewrite([toolResult(text)], "Bash", { crush: false, elide: true }); // no detection: the text route
    const routed = rewrite([toolResult(text)], "Bash", all); // detection: the type's own route
    assert.equal(routed.content[0].content, elideOnly.content[0].content);
    assert.equal(routed.elide.lines, elideOnly.elide.lines);
    assert.deepEqual([routed.log, routed.search, routed.diff, routed.textcrush, routed.split], Array(5).fill({ texts: 0, saved: 0 }));
  }
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

test("wantsQuery with levers also asks for any non-Read text of 300+ characters a query-reading prose lever may rewrite", () => {
  const prose = "a line of ordinary command output\n".repeat(10); // 340 characters
  assert.equal(wantsQuery([toolResult(prose)], "Bash", { split: true }), true);
  assert.equal(wantsQuery([toolResult(prose)], "Bash", { search: true }), true);
  assert.equal(wantsQuery([toolResult(prose)], "Bash", { diff: true }), true);
  assert.equal(wantsQuery([toolResult(prose)], "Bash", { textcrush: true }), true);
  assert.equal(wantsQuery([toolResult(prose)], "Read", { split: true }), false);
  assert.equal(wantsQuery([toolResult(prose, true)], "Bash", { split: true }), false);
  assert.equal(wantsQuery([toolResult(prose)], RETRIEVE_TOOL, { split: true }), false);
  assert.equal(wantsQuery([toolResult(prose.slice(0, 299))], "Bash", { split: true }), false);
  assert.equal(wantsQuery([toolResult(prose)], "Bash", { log: true }), false); // the log compressor never reads the query
  assert.equal(wantsQuery([toolResult(prose)], "Bash", { crush: true }), false); // the two-argument behaviour
  assert.equal(wantsQuery([toolResult(BIG)], "Bash", { crush: false }), false); // the SmartCrusher off: no JSON check
  assert.equal(wantsQuery([toolResult(BIG)], "Bash", { crush: true, split: true }), true);
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
  // Read output (`N\t` line numbers) is a file's source: it must never be extracted to text
  assert.notEqual(detectContentType("1\t<!DOCTYPE html>\n2\t<html>\n3\t<body><p>hi</p></body>\n4\t</html>"), "html");
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

// String, number and mixed-array crushers (upstream crushers.rs and crusher.rs's crush_mixed_array).

const ITEMS_SENTINEL = /^… (\d+) more items <<ccr:([0-9a-f]{12}) \1_items_offloaded>>$/;
// 30 log lines: 5 unique, 20 copies of one filler line, 5 unique, with an error line at 12 and a 400-character line at 18.
const LOG_LINES = [
  ...Array.from({ length: 5 }, (_, i) => `unique opening line number ${i} of the build log output`),
  ...Array.from({ length: 20 }, () => "repeated filler line from the build log output"),
  ...Array.from({ length: 5 }, (_, i) => `unique closing line number ${i} of the build log output`),
];
LOG_LINES[12] = "ERROR: linking failed at step twelve of the build";
LOG_LINES[18] = "x".repeat(400);
// A flat series around 0 with a 5-value spike of about 112 at indices 12..16.
const SPIKE = Array.from({ length: 30 }, (_, i) => (i < 12 || i >= 17 ? i / 1000 : 100 + i));

/**
 * The sample standard deviation, as the number crusher computes it.
 * @param {readonly number[]} xs
 */
function sampleSd(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

test("roundHalfEven rounds a tie to the even integer, as Python's round does", () => {
  assert.deepEqual([0.5, 1.5, 2.5, 3.5, 4.5, 2.4, 2.6, 3].map(roundHalfEven), [0, 2, 2, 4, 4, 2, 3, 3]);
});

test("crushStringArray keeps errors, length anomalies and the first and last items, and skips repeats in its stride", () => {
  const kept = crushStringArray(LOG_LINES);
  assert.ok(kept.length < LOG_LINES.length, String(kept.length));
  for (const s of [LOG_LINES[0], LOG_LINES[12], LOG_LINES[18], LOG_LINES[29]]) assert.ok(kept.includes(s), s.slice(0, 40));
  assert.equal(kept.filter((s) => s === "repeated filler line from the build log output").length, 1);
  const order = kept.map((s) => LOG_LINES.indexOf(s));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  ); // the original order
  const eight = LOG_LINES.slice(0, 8);
  assert.equal(crushStringArray(eight), eight); // 8 or fewer: passed through
});

test("numberChangePoints marks every shifted window, even 1 apart, where the dict analyzer's spacing rule keeps one", () => {
  assert.deepEqual(numberChangePoints(SPIKE, sampleSd(SPIKE)), [11, 12, 17, 18]); // changePoints would keep 11 and 17 only
  const jump = [0, 0, 0, 0, 0, 100, 100, 100, 100, 100];
  assert.deepEqual(numberChangePoints(jump, sampleSd(jump)), []); // 10 numbers: never checked (upstream n > 10)
  // At 11 numbers the one window pair is two groups of 5, whose mean gap can never pass 2 sample σ: none either.
  const eleven = [0, 0, 0, 0, 0, 100, 100, 100, 100, 100, 50];
  assert.deepEqual(numberChangePoints(eleven, sampleSd(eleven)), []);
});

test("crushNumberArray keeps outliers, change points and the first and last numbers", () => {
  const kept = crushNumberArray(SPIKE);
  assert.ok(kept.length < SPIKE.length, String(kept.length));
  for (const i of [0, 11, 12, 13, 14, 15, 16, 17, 18, 29]) assert.ok(kept.includes(SPIKE[i]), String(i));
  assert.deepEqual(
    kept,
    [...kept].sort((a, b) => SPIKE.indexOf(a) - SPIKE.indexOf(b)),
  );
  const eight = SPIKE.slice(0, 8);
  assert.equal(crushNumberArray(eight), eight);
});

test("crushJson closes a string array that lost items with a retrievable sentinel string", () => {
  const r = crushText(JSON.stringify({ lines: LOG_LINES }));
  const lines = r.out.lines;
  const [, n, hash] = ITEMS_SENTINEL.exec(lines.at(-1)) ?? [];
  assert.equal(Number(n), LOG_LINES.length - (lines.length - 1));
  assert.equal(r.rowsDropped, Number(n));
  assert.deepEqual(r.offloaded, [[hash, JSON.stringify(LOG_LINES)]]);
  const rw = rewrite([toolResult(JSON.stringify({ lines: LOG_LINES }))], "Bash", levers());
  assert.equal(rw.crush.dropped, Number(n)); // dropped items count in the crusher's column
});

test("crushJson groups a mixed array by type, and a dict group that compacts keeps every row", () => {
  /** @type {unknown[]} */
  const mix = [];
  for (let i = 0; i < 20; i++)
    mix.push(`build step ${i} finished ok`, i === 7 ? 5000 : 10 + (i % 2), {
      id: i,
      status: "ok",
      note: "the same note on every row of it",
    });
  mix.push(null, null, null);
  const r = crushWith(JSON.stringify({ mix }), BOTH);
  const out = /** @type {unknown[]} */ (JSON.parse(r.text).mix);
  const [, n, hash] = ITEMS_SENTINEL.exec(String(out.at(-1))) ?? [];
  assert.equal(out.filter((x) => typeof x === "object" && x !== null).length, 20); // the table won, so the group stays whole
  assert.equal(out.filter((x) => x === null).length, 3); // a group under 5 is kept
  assert.deepEqual(
    out.filter((x) => typeof x === "number"),
    [10, 5000, 11],
  ); // first, outlier, last
  assert.equal(r.rowsDropped, Number(n));
  assert.deepEqual([r.compacted, r.offloaded], [0, [[hash, JSON.stringify(mix)]]]);
  // Without compaction the dict group is crushed like any dict array.
  const lossy = JSON.parse(crushText(JSON.stringify({ mix })).text).mix;
  assert.ok(lossy.filter((/** @type {unknown} */ x) => typeof x === "object" && x !== null).length < 20);
});

test("crushJson keeps short and lossless-only scalar arrays whole and no longer descends into a 5-8 item mixed array", () => {
  assert.equal(crushJson(JSON.stringify({ lines: LOG_LINES.slice(0, 8), pad: "y".repeat(900) }), ""), undefined); // 8 strings pass through
  assert.equal(crushJson(JSON.stringify({ lines: LOG_LINES }), "", LOSSLESS_ONLY), undefined); // no sentinel without the lossy stage
  // A mixed array of 5 is a mixed array (upstream): crushMixedArray passes it through and nothing inside it is crushed any more.
  assert.equal(crushJson(JSON.stringify({ mix: [1, "a", null, true, { rows: STATUS_ROWS }] }), ""), undefined);
  // 4 items are still descended into, as before.
  assert.match(crushText(JSON.stringify({ mix: [1, "a", null, { rows: STATUS_ROWS }] })).out.mix[3].rows.at(-1)._ccr_dropped, SENTINEL);
});

// Structured config: detection (upstream content_detector.py) and the config compressor (config_compressor.py,
// lossless_compaction.py). Fixtures from upstream tests/test_transforms_config_compressor.py.

const K8S_MANIFEST = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app: web
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: web-1
          image: nginx:1.25
          resources:
            limits:
              cpu: 500m
              memory: 512Mi
            requests:
              cpu: 250m
              memory: 256Mi
        - name: web-2
          image: nginx:1.25
          resources:
            limits:
              cpu: 500m
              memory: 512Mi
            requests:
              cpu: 250m
              memory: 256Mi
        - name: web-3
          image: nginx:1.25
          resources:
            limits:
              cpu: 500m
              memory: 512Mi
            requests:
              cpu: 250m
              memory: 256Mi
`;
const PYPROJECT_TOML = `# Build configuration
[package]
name = "demo"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = "1.0"
tokio = "1.38"

[profile.release]
opt-level = 3
lto = true
`;
const INI_CONFIG = `[server]
host = 127.0.0.1
port = 8080

; connection tuning
[logging]
level = INFO
file = /var/log/app.log

[auth]
enabled = true
provider = ldap
`;
const PROSE = `Note: this document describes the deployment process.
First, you should review the configuration carefully before applying it.
The rollout takes several minutes to complete in most environments.
If anything goes wrong, roll back to the previous release immediately.
Contact the on-call engineer when the dashboard shows sustained errors.
`;
const FRONT_MATTER_DOC = `---
title: My Post
tags:
  - a
  - b
---

# Heading

This is a markdown document body with prose that goes on and on.
More prose here, explaining things in complete English sentences.
And a final line of text to round out the document nicely today.
`;

/**
 * configFlavor over a text's own lines (the test inputs hold no line over DETECT_MAX_LINE_CHARS).
 * @param {string} text
 */
const flavorOf = (text) => configFlavor(text, text.split("\n"));

/**
 * compressConfig that must rewrite; throws when the text passes through.
 * @param {string} text
 */
function compressed(text) {
  const r = compressConfig(text);
  if (!r) throw new Error("expected compressConfig to rewrite the text");
  return r;
}

test("configFlavor and detectContentType claim YAML, TOML and INI", () => {
  for (const [text, flavor] of [
    [K8S_MANIFEST, "yaml"],
    [PYPROJECT_TOML, "toml"],
    [INI_CONFIG, "ini"],
  ]) {
    assert.equal(flavorOf(text), flavor, flavor);
    assert.equal(detectContentType(text), "structured_config", flavor);
  }
  assert.equal(flavorOf("---\nname: a\nimage: x:1\nports:\n  - 80\n---\nname: b\nimage: y:2\nports:\n  - 443\n"), "yaml"); // a multi-document stream
  assert.equal(flavorOf('[a]\nx = "1"\ny = "2"\n[b]\nz = "3"\n'), "toml"); // quoted values: TOML wins
  assert.equal(flavorOf("[a]\nx = hello\ny = world\n[b]\nz = there\n"), "ini"); // bare values are no TOML
});

test("configFlavor claims no prose, front matter, grep, CSV, JSON, code, flat YAML or a single line", () => {
  for (const text of [
    PROSE,
    FRONT_MATTER_DOC,
    "src/main.py:42:def process():\nsrc/util.py:10:import os\nsrc/x.py:5:return 1",
    "name,age,city\nalice,30,nyc\nbob,25,sf\ncarol,35,la",
    '[{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]',
    '{\n  "key": "value",\n  "other": "thing",\n  "third": "entry"\n}',
    "import os\n\n\ndef main():\n    if True:\n        return os.name\n",
    "key: value",
    "alpha: 1\nbeta: 2\ngamma: 3\n", // one indent level, no document marker, no list: too ambiguous
  ]) {
    assert.equal(flavorOf(text), undefined, text.slice(0, 40));
    assert.notEqual(detectContentType(text), "structured_config", text.slice(0, 40));
  }
});

test("isIniAssign accepts what upstream's _INI_ASSIGN_RE matches, in linear time", () => {
  for (const [line, want] of [
    ["key = v", true],
    ["  a b.c-d@e : v", true],
    [" = x", true],
    ["\tkey\t= v", true],
    ["\t= x", false],
    ["a\tb = v", false],
    ["k$y = v", false],
    ["no delimiter", false],
  ])
    assert.equal(isIniAssign(String(line)), want, JSON.stringify(line));
  const t0 = Date.now();
  assert.equal(isIniAssign(`${" ".repeat(100_000)}x`), false); // the lazy regex backtracks quadratically here
  assert.equal(isIniAssign(`${" ".repeat(100_000)}key = v`), true);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});

test("foldRepeatedBlocks folds repeated stanzas reversibly and skips short or unprofitable ones", () => {
  const folded = foldRepeatedBlocks(K8S_MANIFEST);
  assert.ok(folded.length < K8S_MANIFEST.length);
  assert.ok(folded.includes("lines back)"));
  assert.equal(unfoldRepeatedBlocks(folded), K8S_MANIFEST);
  const block = "alpha: value-one\nbeta: value-two\ngamma: value-three\n";
  const consecutive = foldRepeatedBlocks(block.repeat(4));
  assert.ok(consecutive.length < block.length * 4);
  assert.equal(unfoldRepeatedBlocks(consecutive), block.repeat(4));
  assert.equal(foldRepeatedBlocks("x: 1\ny: 2\nx: 1\ny: 2\n"), "x: 1\ny: 2\nx: 1\ny: 2\n"); // repeats of 2 lines
  assert.equal(foldRepeatedBlocks("a\nb\nc\na\nb\nc\n"), "a\nb\nc\na\nb\nc\n"); // the marker would not be shorter
  assert.equal(unfoldRepeatedBlocks("line one\n... (repeats 5 lines from 2 lines back)\n"), "line one\n... (repeats 5 lines from 2 lines back)\n"); // K > D: no fold's marker
  assert.equal(collapseRuns("a\na\na\nb\n"), "a\n... (repeated 3 times)\nb\n");
  assert.equal(expandRuns("a\n... (repeated 3 times)\nb\n"), "a\na\na\nb\n");
});

test("compactConfigLossless verifies its round trip, bails on a marker-shaped line and never expands a marker bomb", () => {
  const c = compactConfigLossless(K8S_MANIFEST);
  assert.ok(c.length < K8S_MANIFEST.length);
  assert.equal(expandRuns(unfoldRepeatedBlocks(c) ?? ""), K8S_MANIFEST);
  const block = ["item: 0", "item: 1", "item: 2"].join("\n");
  const collision = `${block}\n... (repeats 3 lines from 3 lines back)\n${block}\n${block}\n`;
  assert.equal(compactConfigLossless(collision), collision);
  // Each marker doubles the lines before it: unbounded, 40 of them would need 2^40 lines.
  const bomb = ["a", ...Array.from({ length: 40 }, (_, k) => `... (repeats ${2 ** k} lines from ${2 ** k} lines back)`)].join("\n");
  const t0 = Date.now();
  assert.equal(unfoldRepeatedBlocks(bomb, 1000), undefined);
  assert.equal(expandRuns("x\n... (repeated 1000000000 times)\n", 10), undefined);
  assert.equal(compactConfigLossless(bomb), bomb);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});

test("compressConfig elides comments and blank lines behind a retrievable marker, then folds losslessly", () => {
  const notes = [
    "# pinned for CVE-2024-0001; do not bump without checking the advisory",
    "# see https://example.com/advisories/CVE-2024-0001 for details",
    "# owner: platform-team, revisit after the 2.x migration lands",
  ];
  const commented = PYPROJECT_TOML.replace('serde = "1.0"', `${notes.join("\n")}\nserde = "1.0"`);
  const r = compressed(commented);
  const [hash] = r.offloaded[0];
  assert.match(hash, HASH_RE);
  assert.deepEqual(r.offloaded, [[hash, commented]]);
  const kept = ["[package]", 'name = "demo"', 'version = "0.1.0"', 'edition = "2021"', "[dependencies]", 'serde = "1.0"', 'tokio = "1.38"', "[profile.release]", "opt-level = 3", "lto = true"];
  assert.equal(r.text, `${kept.join("\n")}\n[6 comment/blank lines elided. Retrieve original: hash=${hash}]`);
  const folded = compressed(K8S_MANIFEST); // nothing to elide: Tier 1 alone, with its own retrieval line
  const [fh] = folded.offloaded[0];
  assert.deepEqual(folded.offloaded, [[fh, K8S_MANIFEST]]);
  const marker = `\n[Repeated config lines folded. Retrieve original: hash=${fh}]`;
  assert.ok(folded.text.endsWith(marker));
  assert.equal(expandRuns(unfoldRepeatedBlocks(folded.text.slice(0, -marker.length) + "\n") ?? ""), K8S_MANIFEST);
});

test("compressConfig keeps comment lines that may be data, keeps INI blank lines, and passes through what it cannot shorten", () => {
  const blockScalar = "config:\n  script: |\n    # this hash line is DATA inside a block scalar\n    echo hi\n  replicas: 3\n  image: nginx\n  ports:\n    - 80\n";
  assert.equal(flavorOf(blockScalar), "yaml");
  assert.equal(compressConfig(blockScalar), undefined);
  const seqScalar = "steps:\n  - |\n    echo a\n\n    # not a comment\n    echo b\n  - name: x\n  - name: y\n";
  assert.equal(flavorOf(seqScalar), "yaml");
  assert.equal(compressConfig(seqScalar), undefined); // a sequence-item block scalar too
  const tomlMultiline = '[a]\ntext = """\n# not a comment\n"""\nx = "1"\ny = "2"\n';
  assert.equal(flavorOf(tomlMultiline), "toml");
  assert.equal(compressConfig(tomlMultiline), undefined);
  // Deviation: INI refuses Tier 2 around triple quotes too, its flavor being unconfirmed by a parser.
  const notes = "; owner: platform-team, rotate the credentials after every incident review\n; see the runbook in the wiki before changing any value in this section\n";
  const iniMultiline = `[a]\nx = hello\n${notes}y = """\n# looks like a comment\n"""\n`;
  assert.equal(flavorOf(iniMultiline), "ini");
  assert.equal(compressConfig(iniMultiline), undefined);
  const ini = compressed(INI_CONFIG.replace("; connection tuning\n", `; connection tuning\n${notes}`));
  assert.ok(!ini.text.includes("; connection tuning"));
  assert.ok(ini.text.includes("port = 8080\n\n[logging]")); // INI keeps blank lines
  assert.equal(compressConfig(PYPROJECT_TOML), undefined); // the marker costs more than the 3 lines it would save
  assert.equal(compressConfig(PROSE), undefined);
});

test("rewriteToolResults routes structured config to the config compressor, which ends the route like the crusher", () => {
  const yaml = `${K8S_MANIFEST}data:\n  blob: ${"QUJD".repeat(700)}\n`;
  assert.equal(detectContentType(yaml), "structured_config");
  const elided = rewrite([toolResult(yaml)], "Bash", levers({ config: false })); // the config lever off: exactly the elider, as before
  assert.deepEqual([elided.config, elided.elide.lines], [{ texts: 0, saved: 0 }, 1]);
  const r = rewrite([toolResult(yaml)], "Bash", levers({ config: true }));
  const text = String(r.content[0].content);
  assert.deepEqual(r.config, { texts: 1, saved: yaml.length - text.length });
  assert.equal(r.elide.lines, 0); // upstream leaves CONFIG out of _DENSE_ELIDE_AFTER
  assert.ok(text.includes(`  blob: ${"QUJD".repeat(700)}`));
  assert.ok(text.includes("lines back)"));
  assert.deepEqual(
    r.offloaded.map(([, original]) => original),
    [yaml],
  ); // Tier 1 alone: the original goes behind its own retrieval line
});

// HTML extractor (a bounded stand-in for upstream html_extractor.py) and the ELIDE_AFTER route.

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head><title>Release notes</title><style>body { color: #333; font-family: sans-serif; margin: 0 auto; max-width: 60em; }</style>
<script>window.analytics = { id: "UA-000000", track: function () { return true; } };</script></head>
<body>
<nav><a href="/">Home</a> | <a href="/docs">Docs</a></nav>
<!-- build 4711 -->
<main>
<h1>Release   notes</h1>
<p>Version <b>2.4</b> fixes the &lt;cache&gt; bug &amp; adds <a href="https://example.com/changelog">the changelog</a>.</p>
<h2>Changes</h2>
<ul><li>Faster startup</li><li>Smaller &quot;bundle&quot; &#8212; 30&#x25; less</li></ul>
<table><tr><th>Name</th><th>Value</th></tr><tr><td>retries</td><td>3</td></tr></table>
<pre>  indented
    code line</pre>
<p><a href="#top">Back to top</a> <a href="javascript:void(0)">noop</a><br>next line</p>
<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>
</main>
<footer>Copyright 2026 Example Corp. All rights reserved.</footer>
</body>
</html>`;
const PAGE_TEXT = [
  "# Release notes",
  "",
  "Version 2.4 fixes the <cache> bug & adds [the changelog](https://example.com/changelog).",
  "",
  "## Changes",
  "",
  "- Faster startup",
  '- Smaller "bundle" — 30% less',
  "",
  "| Name | Value |",
  "| retries | 3 |",
  "",
  "  indented",
  "    code line",
  "",
  "Back to top noop",
  "next line",
].join("\n");
// Markup that extraction removes, so a short body still comes out shorter than its page.
const HEAD = `<!DOCTYPE html><html><head><style>${"p { margin: 0; padding: 0; } ".repeat(12)}</style></head><body>`;

/**
 * extractHtml that must rewrite; throws when the page passes through.
 * @param {string} html
 */
function extracted(html) {
  const r = extractHtml(html);
  if (!r) throw new Error("expected extractHtml to rewrite the page");
  return r;
}

test("extractHtml keeps headings, lists, links, tables, pre whitespace and decoded text, and drops the boilerplate", () => {
  assert.equal(detectContentType(PAGE), "html");
  const r = extracted(PAGE);
  const [hash] = r.offloaded[0];
  assert.deepEqual(r.offloaded, [[hash, PAGE]]);
  assert.equal(r.text, `${PAGE_TEXT}\n[HTML extracted to text: ${PAGE.length - PAGE_TEXT.length} characters of markup removed. Retrieve original: hash=${hash}]`);
  for (const gone of ["analytics", "font-family", "Home", "build 4711", "Copyright", "M0 0L10 10", "Release notes</title>"]) assert.ok(!r.text.includes(gone), gone);
});

test("extractHtml ends at an unterminated comment or an unclosed drop element, and passes through an empty or longer result", () => {
  assert.ok(extracted(`${HEAD}<p>kept before</p><!-- unterminated <p>never shown</p>`).text.startsWith("kept before\n[HTML extracted to text: "));
  assert.ok(extracted(`${HEAD}<p>kept before</p><script>never closed <p>never shown</p>`).text.startsWith("kept before\n[HTML extracted to text: "));
  assert.equal(extractHtml(`<!DOCTYPE html><html><body><script>${"x".repeat(400)}</script></body></html>`), undefined); // nothing left (upstream #3609)
  assert.equal(extractHtml(`<!DOCTYPE html><p>${"word ".repeat(100)}</p>`), undefined); // the retrieval line costs more than the markup
});

test("extractHtml keeps the text of form, dialog and map elements and drops form controls", () => {
  const r = extracted(
    `${HEAD}<form id="aspnetForm"><h1>Order 4711</h1><p>Shipped today.</p><select><option>noise</option></select><button>Save</button></form><dialog><p>Dialog text.</p></dialog></body></html>`,
  );
  assert.match(r.text, /^# Order 4711\n+Shipped today\.\n+Dialog text\.\n\[HTML extracted to text: /);
});

test("extractHtml gives up on an exhausted scan budget instead of rescanning unterminated quotes", () => {
  const t0 = Date.now();
  assert.equal(extractHtml(`<!DOCTYPE html><html><body>${'<a x="'.repeat(40_000)}`), undefined);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});

test("rewriteToolResults extracts HTML, then elides a dense line of the extraction (ELIDE_AFTER)", () => {
  const blob = "QUJD".repeat(700);
  const page = `${HEAD}<h1>Bundle</h1><pre>${blob}</pre></body></html>`;
  const r = rewrite([toolResult(page)], "Bash", levers({ extract: true }));
  const text = String(r.content[0].content);
  assert.deepEqual([r.extract.pages, r.elide.lines], [1, 1]);
  assert.match(text, /^# Bundle\n\nQUJD/);
  assert.match(
    text,
    /\n\[HTML extracted to text: \d+ characters of markup removed\. Retrieve original: hash=[0-9a-f]{12}\]\n\[1 dense machine-generated line elided\. Retrieve original: hash=[0-9a-f]{12}\]$/,
  );
  assert.equal(r.offloaded.length, 2);
  assert.deepEqual(r.offloaded[0][1], page); // the page, then the extraction the elider shortened
  assert.ok(r.offloaded[1][1].startsWith(`# Bundle\n\n${blob}\n[HTML extracted to text: `));
  assert.equal(r.extract.saved + r.elide.saved, page.length - text.length);
  // The extractor off: the elider alone, on the page as it is (the old html behaviour).
  const old = rewrite([toolResult(page)], "Bash", levers({ extract: false }));
  assert.deepEqual([old.extract.pages, old.elide.lines], [0, 1]);
  assert.ok(String(old.content[0].content).startsWith("<!DOCTYPE html>"));
  // A page that extracts to nothing falls through to the elider.
  const scripted = rewrite([toolResult(`<!DOCTYPE html><html><body><script>${blob}</script></body></html>`)], "Bash", levers({ extract: true }));
  assert.deepEqual([scripted.extract.pages, scripted.elide.lines], [0, 1]);
});

// Tag protector (upstream tag_protector.rs identify_spans, block mode) and the per-lever span guards.

/**
 * The text each span covers.
 * @param {string} text
 */
const spanTexts = (text) => (tagSpans(text) ?? []).map(([a, b]) => text.slice(a, b));

const REMINDER = "<system-reminder>keep-this-reminder-whole</system-reminder>";
// One dense line with a reminder in its middle, then a short line: elided without the tag protector, kept whole with it.
const TAGGED_DENSE = `${"x".repeat(1200)}${REMINDER}${"y".repeat(1200)}\nexit code 0`;

test("tagSpans finds custom tag blocks and self-closing custom tags, never HTML5 tags (upstream vectors)", () => {
  assert.deepEqual(tagSpans("Just plain text"), []);
  assert.deepEqual(tagSpans(""), []);
  assert.deepEqual(tagSpans("<div>Some content</div>"), []);
  assert.deepEqual(tagSpans("<DIV>a</DIV><Span>b</Span>"), []); // HTML names match case-insensitively
  assert.deepEqual(spanTexts("Before <system-reminder>Important</system-reminder> After"), ["<system-reminder>Important</system-reminder>"]);
  assert.deepEqual(spanTexts('<context key="session" type="persistent">user data</context>'), ['<context key="session" type="persistent">user data</context>']);
  assert.deepEqual(spanTexts("Text <marker/> more text"), ["<marker/>"]);
  assert.deepEqual(tagSpans("Text <br/> more <hr/> text"), []);
  assert.deepEqual(spanTexts("<outer><inner>deep</inner></outer>"), ["<outer><inner>deep</inner></outer>"]);
  assert.deepEqual(spanTexts("<div>HTML</div> <system-reminder>Rule</system-reminder> <p>HTML2</p>"), ["<system-reminder>Rule</system-reminder>"]);
  for (const tag of [
    "<tool_call>search({query: 'test'})</tool_call>",
    "<thinking>Let me analyze this</thinking>",
    "<EXTREMELY_IMPORTANT>Never skip validation</EXTREMELY_IMPORTANT>",
    "<user-prompt-submit-hook>check perms</user-prompt-submit-hook>",
    "<system-reminder>Rules</system-reminder>",
    "<result>Success: 42 items</result>",
  ])
    assert.deepEqual(spanTexts(`Before ${tag} After`), [tag], tag);
});

test("tagSpans keeps duplicates apart, collapses deep nesting and ignores orphans, a lone < and truncated tags", () => {
  assert.deepEqual(spanTexts("<system-reminder>same</system-reminder> middle <system-reminder>same</system-reminder>"), [
    "<system-reminder>same</system-reminder>",
    "<system-reminder>same</system-reminder>",
  ]);
  const deep = `${"<lvl>".repeat(60)}core${"</lvl>".repeat(60)}`;
  assert.deepEqual(tagSpans(deep), [[0, deep.length]]);
  assert.deepEqual(spanTexts("<marker/> middle <marker/>"), ["<marker/>", "<marker/>"]);
  assert.deepEqual(tagSpans("no opener </ghost> here"), []);
  assert.deepEqual(tagSpans("<ghost>dangling content with no close"), []);
  assert.deepEqual(tagSpans("if a < b then c"), []);
  for (const text of ["</", "<", "<a/", "<a", "<a /", "</a"]) assert.deepEqual(tagSpans(text), [], text);
  assert.deepEqual(spanTexts('<context attr="a > b">payload</context>'), ['<context attr="a > b">payload</context>']);
  assert.deepEqual(spanTexts("<custom>x</div> y</custom>"), ["<custom>x</div> y</custom>"]); // an HTML close inside a block
  // Deviation: SVG and MathML children are not workflow tags.
  assert.deepEqual(spanTexts('<svg viewBox="0 0 1 1"><g><path d="M0 0"/></g></svg> <note>x</note> <math><mi>x</mi></math>'), ["<note>x</note>"]);
  assert.deepEqual(spanTexts('<svg viewBox="0 0 1 1">\n<note>x</note>'), ["<note>x</note>"]); // an unclosed svg or math hides nothing after it
  assert.deepEqual(spanTexts("x <math> y <note>x</note>"), ["<note>x</note>"]);
});

test("tagSpans returns null when unterminated quotes or a deep stack of unmatched opens exhaust its budget", () => {
  const t0 = Date.now();
  assert.equal(tagSpans('<x a="'.repeat(30_000)), null);
  // 20,000 distinct custom opens, then 20,000 closes that match none: each close walks the whole stack.
  const opens = Array.from({ length: 20_000 }, (_, i) => `<a${i}>`).join("");
  const closes = Array.from({ length: 20_000 }, (_, i) => `</b${i}>`).join("");
  const stress = `${opens}\n${closes}\n${opens}`;
  assert.equal(tagSpans(stress), null);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  // An unprotectable text passes through every lever whole; without the protector its dense lines are elided.
  const lv = levers({ tags: true, compact: true, config: true, extract: true });
  assert.equal(rewriteToolResults([toolResult(stress)], "Bash", lv, ""), undefined);
  assert.equal(rewriteToolResults([toolResult(stress)], "Bash", lv, ""), undefined); // nor folded against its first copy
  assert.equal(rewrite([toolResult(stress)], "Bash", levers({ tags: false })).elide.lines, 3);
  // A moderate stack well under the budget still yields its spans.
  const moderate = `<keep>${"<o>".repeat(50)}${"</c>".repeat(50)}</keep>`;
  assert.deepEqual(tagSpans(moderate), [[0, moderate.length]]);
});

test("the tag protector keeps a dense line holding a custom tag from the elider", () => {
  assert.equal(elideDense(TAGGED_DENSE, tagSpans(TAGGED_DENSE) ?? []), undefined);
  assert.equal(rewriteToolResults([toolResult(TAGGED_DENSE)], "Bash", levers({ tags: true }), ""), undefined);
  assert.equal(rewrite([toolResult(TAGGED_DENSE)], "Bash", levers({ tags: false })).elide.lines, 1);
});

test("the tag protector never folds a repeated reminder block while the runs around it still fold", () => {
  const after = ["4:function delta() { return computeDelta(fourth); }", "5:function epsilon() { return computeEpsilon(fifth); }", "6:function zeta() { return computeZeta(sixth); }"].join("\n");
  const reminder = "<system-reminder>\nThe file may have changed since it was read.\nRead it again before editing it.\n</system-reminder>";
  const block = `${RUN}\n${reminder}\n${after}`;
  const tagged = levers({ tags: true });
  assert.equal(rewriteToolResults([toolResult(block)], "Bash", tagged, ""), undefined); // the first copy: nothing to fold against
  const lines = String(rewrite([toolResult(block)], "Bash", tagged).content[0].content).split("\n");
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^\[↑3L same as result 1: "function alpha\(\) \.\.\." hash=[0-9a-f]{12}\]$/);
  assert.deepEqual(lines.slice(1, 5), reminder.split("\n"));
  assert.match(lines[5], /^\[↑3L same as result 1: "function delta\(\) \.\.\." hash=[0-9a-f]{12}\]$/);
  const plain = levers({ tags: false });
  assert.equal(rewriteToolResults([toolResult(block)], "Bash", plain, ""), undefined);
  assert.match(String(rewrite([toolResult(block)], "Bash", plain).content[0].content), /^\[↑10L same as result 1: /);
});

test("the tag protector drops no row of a JSON document holding a tag, and the config compressor and the HTML extractor decline it", () => {
  const doc = JSON.stringify({ rows: STATUS_ROWS, note: REMINDER });
  assert.equal(rewriteToolResults([toolResult(doc)], "Bash", levers({ tags: true }), ""), undefined); // lossy off, compaction off: untouched
  assert.ok(rewrite([toolResult(doc)], "Bash", levers({ tags: false })).crush.dropped > 0);
  const lossless = rewrite([toolResult(doc)], "Bash", levers({ tags: true, compact: true })); // a lossless table keeps every row
  assert.deepEqual([lossless.crush.dropped, lossless.compact.arrays], [0, 1]);
  assert.equal(JSON.parse(String(lossless.content[0].content)).note, REMINDER);
  const yaml = `${K8S_MANIFEST}note: ${REMINDER}\n`;
  assert.equal(rewriteToolResults([toolResult(yaml)], "Bash", levers({ tags: true, config: true }), ""), undefined);
  assert.equal(rewrite([toolResult(yaml)], "Bash", levers({ tags: false, config: true })).config.texts, 1);
  const page = PAGE.replace("<h2>Changes</h2>", `<h2>Changes</h2>${REMINDER}`);
  assert.equal(rewriteToolResults([toolResult(page)], "Bash", levers({ tags: true, extract: true }), ""), undefined);
  assert.equal(rewrite([toolResult(page)], "Bash", levers({ tags: false, extract: true })).extract.pages, 1);
});

test("after an extraction the elider gets the extracted text's own spans, so a decoded custom tag is guarded (D32)", () => {
  const line = `${"x".repeat(1200)}&lt;system-reminder&gt;keep-this-reminder-whole&lt;/system-reminder&gt;${"y".repeat(1200)}`;
  const page = `${HEAD}<h1>Log</h1><pre>${line}</pre></body></html>`;
  assert.deepEqual(tagSpans(page), []); // the markup holds no custom tag, so the extractor runs
  const decoded = `${"x".repeat(1200)}${REMINDER}${"y".repeat(1200)}`;
  const kept = rewrite([toolResult(page)], "Bash", levers({ extract: true, elide: true, tags: true }));
  assert.deepEqual([kept.extract.pages, kept.elide.lines], [1, 0]);
  assert.ok(String(kept.content[0].content).split("\n").includes(decoded));
  const elided = rewrite([toolResult(page)], "Bash", levers({ extract: true, elide: true, tags: false }));
  assert.deepEqual([elided.extract.pages, elided.elide.lines], [1, 1]);
  assert.ok(!String(elided.content[0].content).includes(REMINDER));
});
// Router compressors (log, search, diff, text crusher, relevance split): shared helpers.
const RUN_LINE = /^\.\.\. \(repeated \d+ times\)$/m;
const RETRIEVE_LINE = /\n\[[^\n]*Retrieve original: hash=([0-9a-f]{12})\]$/;

/**
 * A step's result that must exist (narrows away undefined for the type checker).
 * @template T
 * @param {T|undefined} x
 * @returns {T}
 */
const must = (x) => {
  if (x === undefined) throw new Error("expected a result");
  return x;
};

/**
 * Only the given levers on: no SmartCrusher, elider or dedup unless asked.
 * @param {Partial<Levers>} over
 * @returns {Levers}
 */
const only = (over) => ({ crush: false, elide: false, ...over });

/**
 * rewriteToolResults over one string result; undefined when the row passes through.
 * @param {string} text
 * @param {Levers} lv
 * @param {string} [tool]
 * @param {string} [query]
 */
const route = (text, lv, tool = "Bash", query = "") => rewriteToolResults([toolResult(text)], tool, lv, query);

/**
 * The stored text of a rewritten one-result row.
 * @param {ReturnType<typeof rewriteToolResults>} r
 * @returns {string}
 */
const stored = (r) => {
  if (!r) throw new Error("expected the row to be rewritten");
  return String(r.content[0].content);
};

/** `n` distinct INFO lines, one per build step. */
const infoTicks = (/** @type {number} */ n, from = 0) => Array.from({ length: n }, (_, i) => `INFO step ${from + i}: compiled module_${from + i} into build/out_${from + i}.o`);

/** Upstream log_compressor.rs java_chained_trace: two chained traces with `runtime` JDK frames each. */
const javaTrace = (/** @type {number} */ runtime) =>
  [
    'Exception in thread "main" java.lang.IllegalStateException: boom',
    "at com.example.App.handle(App.java:10)",
    "at com.example.App.dispatch(App.java:20)",
    ...Array.from({ length: runtime }, (_, i) => `at java.base/java.util.stream.Op${i}.eval(Op${i}.java:${i + 1})`),
    "Caused by: java.io.IOException: disk gone",
    "at com.example.Disk.read(Disk.java:77)",
    ...Array.from({ length: runtime }, (_, i) => `at java.base/java.lang.Thread${i}.run(Thread.java:${i + 1})`),
    "... 17 more",
  ].join("\n");

/** Upstream log_compressor.rs pytest_issue_log: a pytest run with `n` failures, each with its own `E ` line. */
const pytestIssueLog = (/** @type {number} */ n) => {
  const pad = (/** @type {number} */ i) => String(i).padStart(3, "0");
  return [
    "============================= test session starts =============================",
    "collected 400 items",
    "",
    ...Array.from({ length: 40 }, (_, i) => `tests/test_module_${String(i).padStart(2, "0")}.py ..........................  [ ${String(i).padStart(2, " ")}%]`),
    "=================================== FAILURES ==================================",
    ...Array.from({ length: n }, (_, k) => [
      `____________________ test_case${pad(k + 1)} ____________________`,
      "",
      ">       assert result == expected",
      `E       AssertionError: mismatch in test_case${pad(k + 1)}`,
      "",
      "tests/t.py:42: AssertionError",
    ]).flat(),
    "=========================== short test summary info ===========================",
    ...Array.from({ length: n }, (_, k) => `FAILED tests/t.py::test_case${pad(k + 1)} - AssertionError: mismatch`),
    `=============== ${n} failed, 380 passed in 41.02s ==============`,
  ].join("\n");
};

test("foldLog strips ANSI colour and collapses repeated lines, and refuses a fold it cannot verify", () => {
  const text = "\x1b[32mok\x1b[0m step one\nretrying connection\nretrying connection\nretrying connection\ndone\n";
  assert.deepEqual(foldLog(text), { text: "ok step one\nretrying connection\n... (repeated 3 times)\ndone\n", offloaded: [] });
  assert.deepEqual(foldLog("\x1b[1mbold\x1b[0m\n"), { text: "bold\n", offloaded: [] }); // colour alone is worth dropping
  assert.equal(foldLog("plain line one\nplain line two\n"), undefined); // nothing to fold
  // A line that already reads like a run marker would expand into lines that were never there.
  assert.equal(foldLog("a\n... (repeated 3 times)\nb\nb\n"), undefined);
});

test("compressLog declines under 50 lines (upstream empty_input_returns_unchanged)", () => {
  assert.equal(compressLog("a\nb\nc"), undefined);
  assert.equal(compressLog(Array.from({ length: 49 }, (_, i) => `ERROR failure number ${i} in the nightly build`).join("\n")), undefined);
});

test("compressLog keeps the error, its context and the omitted-lines summary, and ends with a retrieval line (upstream ccr_marker_descriptor_empty_when_nothing_extractable)", () => {
  let content = "";
  for (let i = 0; i < 50; i++) content += `INFO line ${i}\n`;
  content += "ERROR boom\n";
  const r = must(compressLog(content));
  const [, hash] = RETRIEVE_LINE.exec(r.text) ?? [];
  assert.equal(r.text, `INFO line 47\nINFO line 48\nINFO line 49\nERROR boom\n\n[47 lines omitted: 1 ERROR, 50 INFO]\n[52 lines compressed to 5. Retrieve original: hash=${hash}]`);
  assert.deepEqual(r.offloaded, [[hash, content]]);
  assert.equal(compressLog(content)?.text, r.text); // deterministic: the same input names the same hash
});

test("compressLog keeps the first, the last and the best of more than 10 errors", () => {
  const lines = infoTicks(200);
  for (let k = 1; k <= 19; k++) lines[k * 10] = `ERROR failure #${k} while linking`;
  const r = must(compressLog(lines.join("\n")));
  const kept = r.text.split("\n").flatMap((l) => /^ERROR failure #(\d+)/.exec(l)?.[1] ?? []);
  assert.deepEqual(kept.map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 19]);
});

test("compressLog classifies levels by upstream's exact-casing words and word boundaries (upstream level_classifier tests)", () => {
  const filler = Array.from({ length: 50 }, (_, i) => `step ${i} compiled module_${i} into build/out_${i}.o`);
  const levelsLog = [
    "ERROR: something went wrong",
    "error: file not found",
    "Error: Invalid input",
    "FATAL: system crash",
    "fatal error occurred",
    "CRITICAL: database down",
    "FAIL tests/test_foo.py",
    "FAILED to connect",
    "Test failed",
    "WARN: deprecated function",
    "WARNING: low disk space",
    "warning: unused variable",
    "INFO: starting process",
    "info starting",
    "DEBUG: variable x = 5",
    "debug mode enabled",
    "TRACE: entering function",
    "Just some regular text",
    ...filler,
  ].join("\n");
  assert.match(compressLog(levelsLog)?.text ?? "", /\n\[\d+ lines omitted: 6 ERROR, 3 FAIL, 3 WARN, 2 INFO\]\n/);
  // The first word by position decides: "WARN: error" is a warning.
  assert.match(compressLog(["WARN: error budget nearly spent", ...filler].join("\n"))?.text ?? "", /\n\[\d+ lines omitted: 1 WARN\]\n/);
  // A level word inside a longer word is no level.
  assert.doesNotMatch(compressLog(["informant arrested", "errorless code", "warned-off", ...filler].join("\n"))?.text ?? "", /lines omitted/);
});

test("compressLog dedupes warnings on their message prefix (upstream fixed_in_3e5_dedupe_preserves_distinct_messages, dedupe_collapses_genuinely_repeated_warnings)", () => {
  const lines = infoTicks(70);
  lines[10] = "warning: file /tmp/a/123 issue";
  lines[30] = "warning: file /tmp/b/999 issue"; // digits and the path normalise away: a repeat of line 10
  lines[50] = "WARN segfault at 0xdeadbeef in thread main";
  lines[60] = "WARN heap overflow at 0xcafef00d in thread worker"; // another message: kept
  const out = compressLog(lines.join("\n"))?.text ?? "";
  for (const kept of [lines[10], lines[50], lines[60]]) assert.ok(out.split("\n").includes(kept), kept);
  assert.ok(!out.includes(lines[30]));
});

test("compressLog keeps a chained Python traceback across its blank lines (upstream fixed_in_3e5_chained_exception_traces_survive_blank_lines)", () => {
  const trace = [
    "Traceback (most recent call last):",
    '  File "a.py", line 1, in <module>',
    "ValueError: x",
    "",
    "During handling of the above exception, another exception occurred:",
    "",
    "Traceback (most recent call last):",
    '  File "b.py", line 2, in <module>',
    "RuntimeError: y",
  ];
  const out = compressLog([...infoTicks(50), ...trace, ...infoTicks(10, 50)].join("\n"))?.text ?? "";
  assert.ok(out.includes(trace.join("\n")), out);
});

test("compressLog collapses runtime frames of an oversized trace but keeps its chain heads (upstream collapse_keeps_chain_heads_and_app_frames, small_traces_not_collapsed)", () => {
  const out = compressLog(javaTrace(30))?.text ?? "";
  assert.ok(out.includes("Caused by: java.io.IOException"));
  assert.ok(out.includes("com.example.Disk.read"));
  assert.ok(out.includes("... 17 more"));
  assert.match(out, /^ {6}\[\.\.\. \d+ frames collapsed\]$/m);
  assert.ok(!out.includes("Thread25.run"));
  const small = compressLog([...infoTicks(50), javaTrace(2)].join("\n"))?.text ?? "";
  assert.ok(small.includes(javaTrace(2)));
  assert.ok(!small.includes("frames collapsed]"));
});

test("compressLog reserves pytest's totals and first E line under a binding cap and names every omitted entry (upstream binding_cap_reserves_pytest_totals_and_first_error_line)", () => {
  for (const n of [60, 200]) {
    const out = compressLog(pytestIssueLog(n))?.text ?? "";
    assert.ok(out.includes(`${n} failed, 380 passed`), String(n));
    assert.ok(out.includes("E       AssertionError: mismatch in test_case001"), String(n));
    const lines = out.split("\n");
    const kept = lines.filter((l) => l.startsWith("FAILED tests/t.py::")).length;
    const summary = lines.at(-2) ?? "";
    const named = (summary.split("; omitted: ")[1] ?? "").replace(/\]$/, "");
    const listed = named.split(", ").filter((p) => !p.startsWith("+")).length;
    const overflow = Number(/, \+(\d+) more$/.exec(named)?.[1] ?? 0);
    assert.equal(kept + listed + overflow, n, summary);
  }
});

test("compressLog names the exception types and files it dropped in its retrieval line (upstream ccr_marker_includes_error_types_and_files_when_available)", () => {
  const lines = infoTicks(10);
  for (let i = 0; i < 120; i++) lines.push(`error[E${1000 + i}]: real distinct compile error #${i}`, ` --> src/module_${i}.rs:${i + 1}:1`);
  const out = compressLog(lines.join("\n"))?.text ?? "";
  assert.match(out, /\n\[250 lines compressed to \d+: \d+ files, \d+ exception types \((E\d{4}, ){4}E\d{4}, \.\.\.\)\. Retrieve original: hash=[0-9a-f]{12}\]$/);
});

test("the build route: the log compressor beats a declining fold, a fold that saves nearly as much wins and ends the route", () => {
  const plain = [...infoTicks(60), "ERROR linker exited with code 1"].join("\n");
  assert.equal(detectContentType(plain), "build");
  assert.equal(foldLog(plain), undefined);
  const lossy = route(plain, only({ log: true }));
  assert.equal(stored(lossy), compressLog(plain)?.text); // no fold: merely shorter is enough
  assert.deepEqual(lossy?.log, { texts: 1, saved: plain.length - stored(lossy).length });
  // A fold that halves the log: the lossy result is still under 95% of it.
  const halved = [...infoTicks(60).flatMap((l) => [l, l]), "ERROR linker exited with code 1"].join("\n");
  const fold = must(foldLog(halved));
  const lossyHalved = must(compressLog(halved));
  assert.ok(lossyHalved.text.length <= fold.text.length * 0.95);
  assert.equal(stored(route(halved, only({ log: true }))), lossyHalved.text);
  // 300 identical heartbeats fold to two lines: the lossy result cannot beat that by 5%, so the fold is adopted and ends the route.
  const beats = [...Array(300).fill("INFO heartbeat ok"), "ERROR boom"].join("\n");
  const beatFold = must(foldLog(beats));
  const beatLossy = must(compressLog(beats));
  assert.ok(beatLossy.text.length > beatFold.text.length * 0.95);
  const r = route(beats, only({ log: true, elide: true }));
  assert.equal(stored(r), beatFold.text);
  assert.deepEqual([r?.log.texts, r?.elide.lines, r?.offloaded], [1, 0, []]);
});

test("the build route: a lossy log rewrite is never folded, and the elider still runs on it", () => {
  // Errors are always kept, so the lossy output keeps the two identical adjacent ERROR lines the fold would collapse.
  const twin = infoTicks(60);
  twin[30] = "ERROR disk quota exceeded on /var/cache";
  twin[31] = "ERROR disk quota exceeded on /var/cache";
  const text = twin.join("\n");
  const lossy = must(compressLog(text));
  assert.ok(foldLog(lossy.text)); // the precondition: the fold WOULD rewrite the lossy output
  const r = route(text, only({ log: true, elide: true }));
  assert.equal(stored(r), lossy.text);
  assert.doesNotMatch(stored(r), RUN_LINE);
  assert.equal(r?.log.texts, 1);
  // A dense line in a kept error line: the elider cuts it after the log compressor, and both originals resolve.
  const dense = infoTicks(60);
  dense[30] = `ERROR ${"x".repeat(2500)}`;
  const d = route(dense.join("\n"), only({ log: true, elide: true }));
  const out = stored(d);
  assert.match(out, /\n\[1 dense machine-generated line elided\. Retrieve original: hash=([0-9a-f]{12})\]$/);
  assert.match(out, /\n\[60 lines compressed to \d+\. Retrieve original: hash=[0-9a-f]{12}\]\n/);
  assert.deepEqual([d?.log.texts, d?.elide.lines], [1, 1]);
  const hashes = [...out.matchAll(/hash=([0-9a-f]{12})\]/g)].map((m) => m[1]);
  assert.deepEqual(
    d?.offloaded.map(([h]) => h),
    hashes,
  );
  assert.equal(d?.offloaded[0][1], dense.join("\n"));
});

test("the log compressor leaves Read output, line-numbered text, tagged text and error rows whole, and alone triggers detection", () => {
  const text = [...infoTicks(60), "ERROR linker exited with code 1"].join("\n");
  assert.equal(route(text, only({ log: true }))?.log.texts, 1); // the only lever on: detection still runs
  assert.equal(route(text, only({ log: true }), "Read"), undefined);
  assert.equal(route(`1\t${text}`, only({ log: true })), undefined);
  assert.equal(route(`${text}\n<system-reminder>keep</system-reminder>`, only({ log: true, tags: true })), undefined);
  assert.equal(rewriteToolResults([toolResult(text, true)], "Bash", only({ log: true }), ""), undefined);
  assert.equal(route(text, only({ log: true }), RETRIEVE_TOOL), undefined);
});
test("compressLog stays bounded on 20,000 distinct log lines", () => {
  const text = Array.from({ length: 20_000 }, (_, i) => `${i % 7 === 0 ? "ERROR" : "INFO"} worker ${i} handled request ${i * 7919} in ${i % 97}ms`).join("\n");
  assert.ok(text.length >= 1_000_000);
  const t0 = Date.now();
  const r = route(text, only({ log: true, elide: true }));
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  assert.equal(r?.log.texts, 1);
});
// 60 rows of a file that sorts after every probe path and loses rows: the probe row, when it parses, is the first output row.
const FILLER_ROWS = Array.from({ length: 60 }, (_, i) => `zzz.txt:${i + 1}:filler row number ${i} with distinct words alpha${i} beta${i * 3}`);

/**
 * How compressSearch parses one grep line: its first output row (`file:line:content` as parsed), or a filler row when it does not parse.
 * @param {string} line
 * @returns {string|undefined}
 */
const parsedRow = (line) => compressSearch([line, ...FILLER_ROWS].join("\n"), "")?.text.split("\n")[0];

/** `n` grep rows each of the given files, with distinct content. */
const grepRows = (/** @type {string[]} */ files, /** @type {number} */ n) =>
  files.flatMap((f) => Array.from({ length: n }, (_, i) => `${f}:${(i + 1) * 3}:    value_${f.length}_${i + 1} = compute_${i + 1}(argument_${(i + 1) * 7})`));

test("compressSearch parses grep, ripgrep context and Windows rows as upstream's tiered scan does (upstream parse_match_line tests)", () => {
  /** @type {[string, string][]} */
  const cases = [
    ["src/main.py:42:def main():", "src/main.py:42:def main():"], // parses_standard_grep_line
    ["src/main.py-43-context after match", "src/main.py:43:context after match"], // parses_ripgrep_context_line
    ["app/settings.py-476-a:7:b:8:c", "app/settings.py:476:a:7:b:8:c"], // dash_context_line_wins_over_a_colon_marker_in_its_body
    ["CHANGELOG-12-a:99:b", "CHANGELOG:12:a:99:b"],
    ["app.py-476-foo.rs:12:ref", "app.py:476:foo.rs:12:ref"],
    ["pkg/server.ts-91-lib/index.js:7:import", "pkg/server.ts:91:lib/index.js:7:import"],
    ["logs/2026-05-03/app.log:12:ERROR", "logs/2026-05-03/app.log:12:ERROR"],
    ["migrations/20240101-002-add_users.sql:12:SELECT", "migrations/20240101-002-add_users.sql:12:SELECT"],
    ["notes.md-3-see-4-here", "notes.md:3:see-4-here"], // dash_tier_does_not_run_past_the_path_into_the_body
    ["CHANGELOG.md-7-v1-2-beta", "CHANGELOG.md:7:v1-2-beta"],
    ["CHANGELOG-12-2026-05-03", "CHANGELOG:12:2026-05-03"], // parses_context_line_for_extensionless_path
    ["Makefile-7-build-2-stage", "Makefile:7:build-2-stage"],
    [".github/workflows/ci-9-2026-01-02", ".github/workflows/ci:9:2026-01-02"],
    ["logs/2026-05-03/Makefile-12-all:", "logs/2026-05-03/Makefile:12:all:"], // dated_dir_still_wins_for_an_extensionless_file
    ["Makefile-7-include-2-src/foo.mk", "Makefile:7:include-2-src/foo.mk"], // ambiguous_dash_line_falls_back_to_the_leftmost_marker
    ["Makefile-9-VERSION=v1.2.3-4-gdeadbee", "Makefile:9:VERSION=v1.2.3-4-gdeadbee"], // a_dotted_version_in_the_body_is_not_an_extension
    ["media/2026-05-03/track-2-final.mp3-8-id3", "media/2026-05-03/track-2-final.mp3:8:id3"], // a_real_extension_still_counts_even_with_digits_in_it
    ["manifest.txt-5-logs/2026-05-03/app.log", "manifest.txt:5:logs/2026-05-03/app.log"], // dated_path_inside_a_context_body_is_not_hijacked
    ["C:\\Users\\foo\\bar.py:42:def main():", "C:\\Users\\foo\\bar.py:42:def main():"], // fixed_in_3e2_handles_windows_path_with_backslash
    ["C:/Users/foo/bar.py:42:def main():", "C:/Users/foo/bar.py:42:def main():"], // ... with_forward_slash
    ["pre-commit-config.yaml-42-fail_fast: true", "pre-commit-config.yaml:42:fail_fast: true"], // fixed_in_3e2_handles_dashes_in_filename_with_ripgrep_context
    ["migrations/20240101-002-add_users.sql-9-  id BIGINT", "migrations/20240101-002-add_users.sql:9:  id BIGINT"], // date_stamped_path_is_not_misread_as_line_number_marker
    ["src/main.py-44-see foo.rs:12:bar", "src/main.py:44:see foo.rs:12:bar"], // body_line_reference_does_not_hijack_a_context_line
    ["logs/app.log.1-42-rotated line", "logs/app.log.1:42:rotated line"], // digit_terminated_path_still_parses_ripgrep_context_line
    ['config.py:10:DATABASE_URL = "postgres://user:pass@host:5432/db"', 'config.py:10:DATABASE_URL = "postgres://user:pass@host:5432/db"'], // preserves_colons_in_match_content
  ];
  for (const [line, row] of cases) assert.equal(parsedRow(line), row, line);
  // rejects_lines_without_line_number_marker, rejects_negative_line_numbers: such a line does not parse and is dropped.
  for (const line of ["just a normal line of prose", "file.py:not-a-number:something", ":42:something", "src/file.py:-1:invalid", "src/file.py--1-invalid"]) {
    assert.ok(parsedRow(line)?.startsWith("zzz.txt:"), line);
  }
});

test("compressSearch keeps the first, last and best 5 rows per file within an adaptive total, then a retrieval line (upstream select_respects_per_file_cap_and_global_cap)", () => {
  const text = grepRows(["src/alpha.py", "src/beta.py", "src/gamma.py"], 40).join("\n");
  assert.equal(detectContentType(text), "search");
  const r = must(compressSearch(text, ""));
  const lines = r.text.split("\n");
  for (const f of ["src/alpha.py", "src/beta.py", "src/gamma.py"]) {
    const rows = lines.filter((l) => l.startsWith(`${f}:`));
    assert.equal(rows.length, 5, f);
    assert.ok(rows[0].startsWith(`${f}:3:`) && rows[4].startsWith(`${f}:120:`), f); // first and last, in line order
    assert.ok(lines.includes(`[... and 35 more matches in ${f}]`), f);
  }
  const [, hash] = /\n\[120 matches compressed to 15\. Retrieve original: hash=([0-9a-f]{12})\]$/.exec(r.text) ?? [];
  assert.deepEqual(r.offloaded, [[hash, text]]);
  // At most 15 files: of 20 single-row files with equal scores, the first 15 by path survive.
  const twenty = Array.from({ length: 20 }, (_, i) => `pkg/file${String(i).padStart(2, "0")}.go:${i + 7}:func handler${i}(w http.ResponseWriter, r *http.Request) { serve${i}(w, r) }`);
  const kept = must(compressSearch(twenty.join("\n"), "")).text.split("\n");
  assert.deepEqual(kept.slice(0, -1), twenty.slice(0, 15));
  assert.match(kept.at(-1) ?? "", /^\[20 matches compressed to 15\. Retrieve original: hash=[0-9a-f]{12}\]$/);
});

test("compressSearch keeps an error row and a query row and drops unparsed lines (upstream scoring_boosts_error_lines_in_search_context, parser_groups_by_file_and_counts)", () => {
  const rows = grepRows(["src/alpha.py"], 40);
  rows[17] = "src/alpha.py:54:    raise ConnectionError('upstream timeout')";
  rows[23] = "src/alpha.py:72:    return frobnicate(widget)";
  const text = ["grep: src/vendor: Permission denied", ...rows, "just prose, no marker"].join("\n");
  const out = must(compressSearch(text, "why does frobnicate break the widget")).text.split("\n");
  assert.ok(out.includes(rows[17]));
  assert.ok(out.includes(rows[23]));
  assert.ok(!out.some((l) => l.includes("prose") || l.includes("Permission")));
  assert.equal(must(compressSearch(text, "")).offloaded[0][1], text); // the dropped lines stay retrievable
  assert.equal(compressSearch("plain text only\nand another line", ""), undefined); // upstream empty_input_returns_unchanged
});

test("foldSearch folds repeated files and directories into headings it can invert, skipping timestamped rows", () => {
  const byFile = "src/a.py:1:alpha\nsrc/a.py:2:beta\nsrc/a.py:3:gamma\n";
  assert.deepEqual(foldSearch(byFile), { text: "src/a.py\n1:alpha\n2:beta\n3:gamma\n", offloaded: [] });
  const byDir = "src/pkg/one.py:1:alpha\nsrc/pkg/two.py:2:beta\nsrc/pkg/three.py:3:gamma";
  assert.deepEqual(foldSearch(byDir), { text: "src/pkg/\none.py:1:alpha\ntwo.py:2:beta\nthree.py:3:gamma", offloaded: [] });
  // A timestamped log row has the grep shape but is never folded.
  assert.equal(foldSearch("2026-09-02 14:30:00 [FATAL] one\n2026-09-02 14:30:01 [FATAL] two\n"), undefined);
  // The smaller fold wins: one file with many rows folds better by file than by directory.
  const many = Array.from({ length: 6 }, (_, i) => `lib/core/engine.py:${i + 1}:line ${i}`).join("\n");
  assert.equal(foldSearch(many)?.text, `lib/core/engine.py\n${Array.from({ length: 6 }, (_, i) => `${i + 1}:line ${i}`).join("\n")}`);
  assert.equal(foldSearch("a.py:1:x\nb.py:2:y\n"), undefined); // nothing repeats
});

test("the search route: the search compressor beats a declining fold and a fold it out-saves by 5%, and loses to a fold that saves nearly as much", () => {
  // Rows of two alternating files without a directory: neither fold shrinks them.
  const alternating = Array.from({ length: 60 }, (_, i) => `${i % 2 ? "b.py" : "a.py"}:${i + 1}:    total_${i} = accumulate(series_${i}, window=${i % 9})`).join("\n");
  assert.equal(foldSearch(alternating), undefined);
  const plain = route(alternating, only({ search: true }));
  assert.equal(stored(plain), compressSearch(alternating, "")?.text);
  assert.deepEqual(plain?.search, { texts: 1, saved: alternating.length - stored(plain).length });
  // Three files of 40 rows: the heading fold shrinks them, the lossy cut far more.
  const three = grepRows(["src/alpha.py", "src/beta.py", "src/gamma.py"], 40).join("\n");
  const fold = must(foldSearch(three));
  const lossy = must(compressSearch(three, ""));
  assert.ok(lossy.text.length <= fold.text.length * 0.95);
  assert.equal(stored(route(three, only({ search: true }))), lossy.text);
  // One deep path repeated 8 times: its heading fold leaves almost nothing for the lossy cut to beat.
  const deep = Array.from({ length: 8 }, (_, i) => `src/${"deep/".repeat(20)}module.py:${i + 1}:x = ${i}`).join("\n");
  const deepFold = must(foldSearch(deep));
  assert.ok(must(compressSearch(deep, "")).text.length > deepFold.text.length * 0.95);
  const r = route(deep, only({ search: true, elide: true }));
  assert.equal(stored(r), deepFold.text);
  assert.deepEqual([r?.search.texts, r?.elide.lines, r?.offloaded], [1, 0, []]);
});

test("the search route: a lossy search rewrite is never folded into headings, and the elider still runs on it", () => {
  const text = grepRows(["src/alpha.py", "src/beta.py", "src/gamma.py"], 40).join("\n");
  const lossy = must(compressSearch(text, ""));
  assert.ok(foldSearch(lossy.text)); // the precondition: the fold WOULD rewrite the lossy output's consecutive rows
  const r = route(text, only({ search: true, elide: true }));
  assert.equal(stored(r), lossy.text);
  assert.ok(stored(r).split("\n").includes("src/alpha.py:3:    value_12_1 = compute_1(argument_7)")); // still file:line:content, no heading row
  assert.ok(!stored(r).split("\n").includes("src/alpha.py"));
  assert.equal(r?.search.texts, 1);
  // A dense first row of a file is always kept: the elider cuts it after the search compressor.
  const dense = grepRows(["src/alpha.py", "src/beta.py"], 40);
  dense[0] = `src/alpha.py:3:${"x".repeat(2500)}`;
  const d = route(dense.join("\n"), only({ search: true, elide: true }));
  const out = stored(d);
  assert.match(out, /\n\[80 matches compressed to \d+\. Retrieve original: hash=[0-9a-f]{12}\]\n\[1 dense machine-generated line elided\. Retrieve original: hash=[0-9a-f]{12}\]$/);
  assert.deepEqual([d?.search.texts, d?.elide.lines], [1, 1]);
  assert.deepEqual(
    d?.offloaded.map(([h]) => h),
    [...out.matchAll(/hash=([0-9a-f]{12})\]/g)].map((m) => m[1]),
  );
});

test("the search compressor leaves Read output, line-numbered text, tagged text and error rows whole, and alone triggers detection", () => {
  const text = grepRows(["src/alpha.py", "src/beta.py", "src/gamma.py"], 40).join("\n");
  assert.equal(route(text, only({ search: true }))?.search.texts, 1);
  assert.equal(route(text, only({ search: true }), "Read"), undefined);
  assert.equal(route(`1\t${text}`, only({ search: true })), undefined);
  assert.equal(route(`${text}\n<system-reminder>keep</system-reminder>`, only({ search: true, tags: true })), undefined);
  assert.equal(rewriteToolResults([toolResult(text, true)], "Bash", only({ search: true }), ""), undefined);
});

test("compressSearch stays bounded on 50,000 rows with a 16 KiB query and on one adversarial marker line", () => {
  const rows = Array.from({ length: 50_000 }, (_, i) => `src/m${i % 400}/file${i % 1200}.py:${i + 1}:value_${i} = compute(${i})`).join("\n");
  const query = Array.from({ length: 2000 }, (_, i) => `word${i}`)
    .join(" ")
    .slice(0, 16_384);
  let t0 = Date.now();
  assert.ok(compressSearch(rows, query));
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  // Every dash marker of this one line has path structure after it, so the dash tier would rescan the line per marker: the
  // budget declines it instead.
  const hostile = `${"a:1-a-1-".repeat(125_000)}/x`;
  t0 = Date.now();
  assert.equal(compressSearch(hostile, ""), undefined);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
});
/** Upstream diff_compressor.rs build_synthetic_diff: `n` files with one 18-line hunk each (5 context, 3 removed, 5 added, 5 context). */
const syntheticDiff = (/** @type {number} */ n) =>
  Array.from({ length: n }, (_, i) =>
    [
      `diff --git a/file_${i}.py b/file_${i}.py`,
      `--- a/file_${i}.py`,
      `+++ b/file_${i}.py`,
      "@@ -1,10 +1,12 @@",
      ...Array.from({ length: 5 }, (_, k) => ` context_${k}_${i}`),
      ...Array.from({ length: 3 }, (_, k) => `-removed_${k}_${i}`),
      ...Array.from({ length: 5 }, (_, k) => `+added_${k}_${i}`),
      ...Array.from({ length: 5 }, (_, k) => ` tail_${k}_${i}`),
      "",
    ].join("\n"),
  ).join("") + "# variant 1";

/** Upstream diff_compressor.rs build_n_hunk_diff: one file with `n` 6-line hunks 100 lines apart (`index` adds git's bookkeeping line). */
const nHunkDiff = (/** @type {number} */ n, index = false) =>
  [
    "diff --git a/big.py b/big.py",
    ...(index ? ["index 3b18e512dba79e4c8300dd08aeb37f8e728b8dad..af5626b4a114abcb82d63db7c8082c3c4756e51b 100644"] : []),
    "--- a/big.py",
    "+++ b/big.py",
    ...Array.from({ length: n }, (_, i) => [`@@ -${i * 100 + 1},6 +${i * 100 + 1},6 @@`, ` ctx_a_${i}`, ` ctx_b_${i}`, `-old_${i}`, `+new_${i}`, ` ctx_c_${i}`, ` ctx_d_${i}`]).flat(),
    "",
  ].join("\n");

// A second file whose 60 unchanged lines the context trim drops: pads a small fixture past 50 lines and makes it compress.
const PAD_FILE = [
  "diff --git a/pad.txt b/pad.txt",
  "--- a/pad.txt",
  "+++ b/pad.txt",
  "@@ -1,61 +1,61 @@",
  "-old pad",
  "+new pad",
  ...Array.from({ length: 60 }, (_, i) => ` unchanged pad line ${i}`),
].join("\n");

test("compressDiff declines a short input and a text without a file header (upstream short_input_passes_through, non_diff_input_passes_through)", () => {
  assert.equal(compressDiff("diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b", ""), undefined);
  assert.equal(compressDiff("this is not a diff\n".repeat(60), ""), undefined);
  assert.equal(compressDiff(`${"+ added line\n".repeat(60)}--- a/x.py\n`, ""), undefined);
});

test("compressDiff trims context to 2 lines and ends with the footer and a retrieval line (upstream synthetic_eight_file_diff_matches_known_shape)", () => {
  const input = syntheticDiff(8);
  assert.equal(input.split("\n").length, 177);
  const r = must(compressDiff(input, ""));
  const lines = r.text.split("\n");
  const [, hash] = /^\[177 lines compressed to 129\. Retrieve original: hash=([0-9a-f]{12})\]$/.exec(lines.at(-1) ?? "") ?? [];
  assert.ok(hash, lines.at(-1));
  assert.equal(lines.at(-2), "[8 files changed, +40 -24 lines]");
  assert.deepEqual(r.offloaded, [[hash, input]]);
  // Each hunk keeps the 2 context lines on either side of its 8 changes: 12 of 18 lines.
  assert.deepEqual(lines.slice(0, 16), [
    "diff --git a/file_0.py b/file_0.py",
    "--- a/file_0.py",
    "+++ b/file_0.py",
    "@@ -1,10 +1,12 @@",
    " context_3_0",
    " context_4_0",
    "-removed_0_0",
    "-removed_1_0",
    "-removed_2_0",
    "+added_0_0",
    "+added_1_0",
    "+added_2_0",
    "+added_3_0",
    "+added_4_0",
    " tail_0_0",
    " tail_1_0",
  ]);
});

test("compressDiff keeps the first, the last and 8 middle hunks of a file, counting the dropped ones' lines (upstream max_hunks_per_file_cap_drops_excess_and_records_stats)", () => {
  const out = must(compressDiff(nHunkDiff(15), "")).text;
  const headers = out.split("\n").filter((l) => l.startsWith("@@ "));
  assert.equal(headers.length, 10);
  assert.equal(headers[0], "@@ -1,6 +1,6 @@");
  assert.equal(headers[9], "@@ -1401,6 +1401,6 @@");
  assert.match(out, /\n\[1 files changed, \+15 -15 lines, 5 hunks omitted\]\n/);
  // A query word and a priority word lift their middle hunks into the 8 kept ones.
  const marked = nHunkDiff(15).replace("+new_12", "+new_12 frobnicate(widget)").replace("+new_13", "+new_13  # TODO tidy");
  assert.ok(!must(compressDiff(marked, "")).text.includes("frobnicate"));
  assert.ok(must(compressDiff(marked, "")).text.includes("# TODO tidy"));
  assert.ok(must(compressDiff(marked, "why does frobnicate break")).text.includes("frobnicate(widget)"));
});

test("compressDiff keeps the 20 most-changed of more files (upstream max_files_cap_drops_files_and_records_names_in_stats)", () => {
  const out = must(compressDiff(syntheticDiff(25), "")).text;
  assert.match(out, /\n\[20 files changed, \+100 -60 lines\]\n/);
  assert.ok(out.includes("diff --git a/file_19.py b/file_19.py"));
  assert.ok(!out.includes("file_20.py"));
});

test("compressDiff normalises mode and binary lines and keeps rename lines, combined hunks, no-newline markers and pre-diff lines (upstream file_mode, binary, bugfix and gap tests)", () => {
  const exec = must(
    compressDiff(
      ["diff --git a/script.sh b/script.sh", "new file mode 100755", "--- /dev/null", "+++ b/script.sh", "@@ -0,0 +1,3 @@", "+#!/bin/sh", "+echo hi", "+exit 0", ...Array(50).fill("# pad")].join("\n"),
      "",
    ),
  ).text;
  assert.ok(exec.includes("diff --git a/script.sh b/script.sh\nnew file mode 100644\n--- /dev/null\n+++ b/script.sh"));
  assert.ok(!exec.includes("100755"));
  const binary = must(compressDiff(["diff --git a/img.png b/img.png", "Binary files a/img.png and b/img.png differ", ...Array(60).fill("# pad")].join("\n"), "")).text;
  assert.match(binary, /^diff --git a\/img\.png b\/img\.png\nBinary files differ\n\[1 files changed, \+0 -0 lines\]\n/);
  const renamed = must(
    compressDiff(
      [
        "diff --git a/old.py b/new.py",
        "similarity index 92%",
        "rename from old.py",
        "rename to new.py",
        "--- a/old.py",
        "+++ b/new.py",
        "@@ -1,3 +1,3 @@",
        " ctx_a",
        "-old_line",
        "+new_line",
        " ctx_b",
        PAD_FILE,
      ].join("\n"),
      "",
    ),
  ).text;
  assert.ok(renamed.startsWith("diff --git a/old.py b/new.py\nsimilarity index 92%\nrename from old.py\nrename to new.py\n--- a/old.py\n+++ b/new.py\n"));
  const merged = must(
    compressDiff(
      [
        "diff --git a/merge.py b/merge.py",
        "--- a/merge.py",
        "+++ b/merge.py",
        "@@@ -1,3 -1,3 +1,4 @@@",
        "  unchanged_a",
        " -old_branch_1",
        "- old_branch_2",
        "++new_in_merge",
        " +new_added",
        "  unchanged_b",
        PAD_FILE,
      ].join("\n"),
      "",
    ),
  ).text;
  assert.ok(merged.includes("@@@ -1,3 -1,3 +1,4 @@@\n  unchanged_a\n -old_branch_1\n- old_branch_2\n++new_in_merge\n +new_added\n  unchanged_b"));
  const noNewline = must(
    compressDiff(
      [
        "diff --git a/last.txt b/last.txt",
        "--- a/last.txt",
        "+++ b/last.txt",
        "@@ -1,8 +1,8 @@",
        "-old_first",
        "+new_first",
        ...["a", "b", "c", "d", "e", "f"].map((c) => ` ctx_${c}`),
        "\\ No newline at end of file",
        PAD_FILE,
      ].join("\n"),
      "",
    ),
  ).text;
  assert.ok(noNewline.includes("+new_first\n ctx_a\n ctx_b\n\\ No newline at end of file\n"));
  for (const header of ["diff --combined merge.py", "diff --cc cc_target.py"]) {
    const out = must(
      compressDiff(
        [header, "index abc..def..ghi 100644", "--- a/merge.py", "+++ b/merge.py", "@@@ -1,3 -1,3 +1,4 @@@", "  ctx_a", "- removed_p1", " -removed_p2", "++added_in_merge", "  ctx_b", PAD_FILE].join(
          "\n",
        ),
        "",
      ),
    ).text;
    assert.ok(out.startsWith(`${header}\n--- a/merge.py\n+++ b/merge.py\n@@@ -1,3 -1,3 +1,4 @@@\n`), header);
    assert.match(out, /\n\[2 files changed, /);
  }
  const commit = must(
    compressDiff(["commit abc1234567890", "Author: Tester <t@example.com>", "Date:   Mon Apr 25 12:00:00 2026", "", "    Refactor: rename and modify", "", PAD_FILE].join("\n"), ""),
  ).text;
  assert.ok(commit.startsWith("commit abc1234567890\nAuthor: Tester <t@example.com>\nDate:   Mon Apr 25 12:00:00 2026\n\n    Refactor: rename and modify\n\ndiff --git a/pad.txt b/pad.txt\n"));
});

test("foldDiff drops only index lines", () => {
  const text = "diff --git a/x b/x\nindex 83db48f..f735c3e 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-index 1..2\n+b\n";
  assert.deepEqual(foldDiff(text), { text: "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-index 1..2\n+b\n", offloaded: [] });
  assert.equal(foldDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n"), undefined);
});

test("the diff route: a real git diff reaches the diff compressor over its index-strip fold, a diff rewrite is never elided, and a fold that saves nearly as much wins", () => {
  const real = nHunkDiff(15, true);
  assert.equal(detectContentType(real), "diff");
  const fold = must(foldDiff(real));
  const lossy = must(compressDiff(real, ""));
  assert.ok(lossy.text.length <= fold.text.length * 0.95);
  const r = route(real, only({ diff: true, elide: true }));
  assert.equal(stored(r), lossy.text);
  assert.ok(!stored(r).includes("index 3b18e51"));
  assert.equal(r?.diff.texts, 1);
  // No index line: no fold, so merely shorter is enough.
  assert.equal(foldDiff(nHunkDiff(15)), undefined);
  assert.equal(stored(route(nHunkDiff(15), only({ diff: true }))), compressDiff(nHunkDiff(15), "")?.text);
  // A dense added line in a kept hunk: the diff rewrite ends the route, so the elider never sees it.
  const dense = nHunkDiff(15).replace("+new_0", `+${"x".repeat(2500)}`);
  const d = route(dense, only({ diff: true, elide: true }));
  assert.ok(stored(d).includes("x".repeat(2500)));
  assert.deepEqual([d?.diff.texts, d?.elide.lines], [1, 0]);
  // Twelve files whose hunks hold nothing to trim: the lossy rewrite only drops the index lines the fold drops too, plus its
  // footer and retrieval line, so the fold wins and ends the route.
  const tight = Array.from({ length: 12 }, (_, i) =>
    [
      `diff --git a/m${i}.py b/m${i}.py`,
      `index ${"a".repeat(40)}..${"b".repeat(40)} 100644`,
      `--- a/m${i}.py`,
      `+++ b/m${i}.py`,
      "@@ -1,5 +1,5 @@",
      " a",
      " b",
      `-old ${i}`,
      `+new ${i}`,
      " c",
      " d",
    ].join("\n"),
  ).join("\n");
  const tightFold = must(foldDiff(tight));
  assert.ok(must(compressDiff(tight, "")).text.length > tightFold.text.length * 0.95);
  const t = route(tight, only({ diff: true, elide: true }));
  assert.equal(stored(t), tightFold.text);
  assert.deepEqual([t?.diff.texts, t?.offloaded], [1, []]);
});

test("the diff compressor leaves Read output, line-numbered text, tagged text and error rows whole, and alone triggers detection", () => {
  const text = nHunkDiff(15);
  assert.equal(route(text, only({ diff: true }))?.diff.texts, 1);
  assert.equal(route(text, only({ diff: true }), "Read"), undefined);
  assert.equal(route(`1\t${text}`, only({ diff: true })), undefined);
  assert.equal(route(text.replace("+new_3", "+new_3 <system-reminder>keep</system-reminder>"), only({ diff: true, tags: true })), undefined);
  assert.equal(rewriteToolResults([toolResult(text, true)], "Bash", only({ diff: true }), ""), undefined);
});

test("compressDiff stays bounded on a header line holding 250,000 ` b/`", () => {
  const text = `diff --git a/x${" b/x".repeat(250_000)}\n${nHunkDiff(15).split("\n").slice(1).join("\n")}`;
  assert.ok(text.length >= 1_000_000);
  const t0 = Date.now();
  assert.ok(compressDiff(text, ""));
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
});
/** `n` distinct prose sentences on one line each. */
const sentences = (/** @type {number} */ n, from = 0) => Array.from({ length: n }, (_, i) => `Paragraph ${from + i} explains how the scheduler balances queue ${from + i} against its neighbours.`);

test("foldText collapses repeated lines it can expand back, and only when that is shorter", () => {
  assert.deepEqual(foldText("intro\nthe same long repeated line\nthe same long repeated line\nthe same long repeated line\noutro"), {
    text: "intro\nthe same long repeated line\n... (repeated 3 times)\noutro",
    offloaded: [],
  });
  assert.equal(foldText("one\ntwo\nthree"), undefined);
  assert.equal(foldText("a\n... (repeated 9 times)\nb\nb"), undefined); // a marker-shaped line would not expand back
});

test("crushText matches upstream's parity fixture and declines short and CJK text (upstream plain_prose_no_query, short_passthrough, unicode)", () => {
  const content = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} explains how distributed systems reconcile state across topic ${i}.`).join(" ");
  const r = must(crushProse(content, ""));
  const [, hash] = /\n\[Text crushed: 15 of 30 segments kept\. Retrieve original: hash=([0-9a-f]{12})\]$/.exec(r.text) ?? [];
  assert.equal(
    r.text.slice(0, r.text.lastIndexOf("\n")),
    Array.from({ length: 15 }, (_, i) => `Sentence number ${i + 15} explains how distributed systems reconcile state across topic ${i + 15}.`).join("\n"),
  );
  assert.deepEqual(r.offloaded, [[hash, content]]);
  assert.equal(crushProse(content, "")?.text, r.text); // deterministic
  assert.equal(crushProse("one thing. two thing. three thing.", ""), undefined); // fewer than 6 segments
  const cjk = Array.from({ length: 12 }, (_, i) => `句子 ${i} 描述了系统在主题 ${i} 上的行为细节。`).join(" ");
  assert.equal(crushProse(cjk, "系统"), undefined);
  assert.equal(crushProse(`${content} Ｆｕｌｌ-width forms count as CJK too.`, ""), undefined);
});

test("crushText is extractive, suppresses near-duplicates and keeps the query's and the salient segments (upstream test_text_crusher.py)", () => {
  const doc = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} describes a distinct topic ${i} in some detail.`).join(" ");
  const words = new Set(doc.split(/\s+/));
  const kept = must(crushProse(doc, "")).text.split("\n").slice(0, -1);
  assert.ok(kept.every((s) => s.split(/\s+/).every((w) => words.has(w))));
  const dup = "The quick brown fox jumps over the very lazy dog today.";
  const uniques = Array.from({ length: 8 }, (_, i) => `A unique fact about item ${i} stated plainly here.`);
  assert.ok((must(crushProse([...Array(10).fill(dup), ...uniques].join("\n"), "")).text.match(/quick brown fox/g) ?? []).length <= 2);
  const filler = Array.from({ length: 30 }, (_, i) => `Filler line number ${i} with generic words and padding here.`);
  const needle = "The authentication token expires after thirty minutes of inactivity.";
  const text = [...filler.slice(0, 15), needle, ...filler.slice(15)].join("\n");
  assert.ok(must(crushProse(text, "how long until the authentication token expires")).text.includes(needle));
  assert.ok(!must(crushProse(text, "")).text.includes(needle)); // without the query, recency keeps the later filler instead
  // Digits, ALLCAPS and dotted identifiers outrank plain early prose.
  const plain = Array.from({ length: 6 }, (_, i) => `plain words describe the general behaviour of things in vague terms ${"abcdef"[i]}`);
  const salient = "ERROR at pipeline.apply returned HTTP 503 for request 9182 after 3 tries";
  const out = must(crushProse([salient, ...plain, ...plain.map((p) => `${p} again`)].join("\n"), "")).text;
  assert.ok(out.split("\n").includes(salient), out);
  assert.ok(!out.split("\n").includes(plain[0]), out);
});

test("the text route: the text crusher beats a declining fold and a fold it out-saves by 5%, and loses to a fold that saves nearly as much", () => {
  const prose = sentences(20).join("\n");
  assert.equal(detectContentType(prose), "text");
  assert.equal(foldText(prose), undefined);
  const plain = route(prose, only({ textcrush: true }));
  assert.equal(stored(plain), crushProse(prose, "")?.text);
  assert.deepEqual(plain?.textcrush, { texts: 1, saved: prose.length - stored(plain).length });
  // One repeated pair: the fold saves a line, the crusher half the text.
  const lines = sentences(20);
  lines.splice(5, 0, lines[5]);
  const some = lines.join("\n");
  const fold = must(foldText(some));
  const lossy = must(crushProse(some, ""));
  assert.ok(lossy.text.length <= fold.text.length * 0.95);
  assert.equal(stored(route(some, only({ textcrush: true }))), lossy.text);
  // Sixty identical retries: the fold leaves two lines for them, which the crusher cannot beat by 5%.
  const retries = [...sentences(8), ...Array(60).fill("retrying the connection to the database server now")].join("\n");
  const retryFold = must(foldText(retries));
  assert.ok(must(crushProse(retries, "")).text.length > retryFold.text.length * 0.95);
  const r = route(retries, only({ textcrush: true, elide: true }));
  assert.equal(stored(r), retryFold.text);
  assert.deepEqual([r?.textcrush.texts, r?.elide.lines, r?.offloaded], [1, 0, []]);
});

test("the text route: a crushed text is never folded, and the elider still runs on it", () => {
  // With an empty query recency decides, so the last three segments stay adjacent; they carry no token, so no shingle drops them.
  const text = [...sentences(12), ..."===".split("").map(() => "=".repeat(80))].join("\n");
  const lossy = must(crushProse(text, ""));
  assert.ok(foldText(lossy.text)); // the precondition: the fold WOULD collapse the crushed output's three identical lines
  const r = route(text, only({ textcrush: true, elide: true }));
  assert.equal(stored(r), lossy.text);
  assert.doesNotMatch(stored(r), RUN_LINE);
  assert.equal(r?.textcrush.texts, 1);
  // A dense last segment: recency keeps it, and the elider cuts it after the crusher.
  const d = route([...sentences(12), "x".repeat(2500)].join("\n"), only({ textcrush: true, elide: true }));
  const out = stored(d);
  assert.match(out, /\n\[Text crushed: \d+ of 13 segments kept\. Retrieve original: hash=[0-9a-f]{12}\]\n\[1 dense machine-generated line elided\. Retrieve original: hash=[0-9a-f]{12}\]$/);
  assert.deepEqual([d?.textcrush.texts, d?.elide.lines], [1, 1]);
  assert.deepEqual(
    d?.offloaded.map(([h]) => h),
    [...out.matchAll(/hash=([0-9a-f]{12})\]/g)].map((m) => m[1]),
  );
});

test("the text crusher leaves Read output, line-numbered text, tagged text and error rows whole, and alone triggers detection", () => {
  const text = sentences(20).join("\n");
  assert.equal(route(text, only({ textcrush: true }))?.textcrush.texts, 1);
  assert.equal(route(text, only({ textcrush: true }), "Read"), undefined);
  assert.equal(route(`1\t${text}`, only({ textcrush: true })), undefined);
  assert.equal(route(`${text}\n<system-reminder>keep</system-reminder>`, only({ textcrush: true, tags: true })), undefined);
  assert.equal(rewriteToolResults([toolResult(text, true)], "Bash", only({ textcrush: true }), ""), undefined);
});

test("crushText stays bounded on 20,000 sentences", () => {
  const text = Array.from({ length: 20_000 }, (_, i) => `Sentence ${i} notes that worker ${i % 97} finished job ${i * 31} quickly.`).join(" ");
  assert.ok(text.length >= 1_000_000);
  const t0 = Date.now();
  assert.ok(crushProse(text, "which worker finished the job"));
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
});
