import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitFrontmatter, stripLlmWrapper, validate, buildCompressPrompt, buildFixPrompt,
  MAX_INPUT_BYTES, MAX_RETRIES,
} from "../../plugins/cave-context/mcp/compress.mjs";

test("splitFrontmatter peels a leading YAML block and keeps the body", () => {
  const text = "---\nname: x\n---\nHello body\n";
  const { frontmatter, body } = splitFrontmatter(text);
  assert.equal(frontmatter, "---\nname: x\n---\n");
  assert.equal(body, "Hello body\n");
});

test("splitFrontmatter returns empty frontmatter when none present", () => {
  const { frontmatter, body } = splitFrontmatter("no frontmatter here");
  assert.equal(frontmatter, "");
  assert.equal(body, "no frontmatter here");
});

test("stripLlmWrapper unwraps an outer markdown fence only", () => {
  assert.equal(stripLlmWrapper("```markdown\ninner\n```"), "inner");
  assert.equal(stripLlmWrapper("plain text"), "plain text");
});

test("validate flags a dropped URL, code block, and heading", () => {
  const original = "# Title\nSee https://example.com/x\n```js\nconst a = 1;\n```\n";
  const bad = "Title\nSee\n";
  const r = validate(original, bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("https://example.com/x")));
  assert.ok(r.errors.some((e) => /code block/i.test(e)));
  assert.ok(r.errors.some((e) => /heading/i.test(e)));
});

test("validate passes when verbatim regions are preserved", () => {
  const original = "# Title\nSee https://example.com/x\n```js\nconst a = 1;\n```\n";
  const good = "# Title\nsee https://example.com/x\n```js\nconst a = 1;\n```\n";
  assert.deepEqual(validate(original, good), { valid: true, errors: [] });
});

test("prompts embed ruleset and the no-outer-fence instruction; constants exported", () => {
  assert.match(buildCompressPrompt("BODY"), /PRESERVE VERBATIM/);
  assert.match(buildCompressPrompt("BODY"), /Do NOT wrap/i);
  assert.match(buildCompressPrompt("BODY"), /BODY/);
  assert.match(buildFixPrompt("O", "C", ["Missing URL: u"]), /Missing URL: u/);
  assert.equal(MAX_INPUT_BYTES, 500000);
  assert.equal(MAX_RETRIES, 2);
});
