import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExpectedSha } from "../../plugins/linux-token-efficiency/mcp/binary-fetch.mjs";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);

test("parseExpectedSha: exactly one text-mode match returns the hash", () => {
  const text = `${OTHER}  other.tar.gz\n${HASH}  asset.tar.gz\n`;
  assert.equal(parseExpectedSha(text, "asset.tar.gz"), HASH);
});

test("parseExpectedSha: binary-mode '*' prefix on the filename matches", () => {
  assert.equal(parseExpectedSha(`${HASH} *asset.tar.gz\n`, "asset.tar.gz"), HASH);
});

test("parseExpectedSha: blank lines are ignored", () => {
  assert.equal(parseExpectedSha(`\n\n${HASH}  asset.tar.gz\n\n`, "asset.tar.gz"), HASH);
});

test("parseExpectedSha: zero matches throws", () => {
  assert.throws(() => parseExpectedSha(`${HASH}  other.tar.gz\n`, "asset.tar.gz"), /exactly one/);
});

test("parseExpectedSha: duplicate asset lines throw", () => {
  const text = `${HASH}  asset.tar.gz\n${OTHER}  asset.tar.gz\n`;
  assert.throws(() => parseExpectedSha(text, "asset.tar.gz"), /exactly one/);
});

test("parseExpectedSha: malformed hash throws", () => {
  assert.throws(() => parseExpectedSha(`ZZZ  asset.tar.gz\n`, "asset.tar.gz"), /malformed/);
});

test("parseExpectedSha: uppercase hash is rejected as malformed", () => {
  assert.throws(() => parseExpectedSha(`${HASH.toUpperCase()}  asset.tar.gz\n`, "asset.tar.gz"), /malformed/);
});
