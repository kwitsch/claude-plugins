import { test } from "node:test";
import assert from "node:assert/strict";
import { CACHE_DROP_THRESHOLD, EFFORT_ORDER, MAX_FINDINGS, cacheHitRatio, clampEffort, findVolatile, isCacheDrop, isToolError } from "../../plugins/inline-headroom/hooks/policy.mjs";

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
