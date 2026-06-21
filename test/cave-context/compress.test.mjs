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

import { compressText } from "../../plugins/cave-context/mcp/compress.mjs";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Write an executable fake `claude` that ignores the CLI flags, reads the prompt
// from stdin, and emits scripted output. Behavior is controlled by env:
//   FAKE_OUT      — text to print on every call
//   FAKE_OUT_2    — if set, printed from the 2nd call onward (uses FAKE_COUNTER file)
//   FAKE_COUNTER  — path to a counter file (created by the fake)
//   FAKE_EXIT     — non-zero exit code to simulate a CLI failure
function makeFakeClaude(dir) {
  const p = join(dir, "fake-claude.mjs");
  writeFileSync(p, `#!/usr/bin/env node
import fs from "node:fs";
let n = 1;
const cf = process.env.FAKE_COUNTER;
if (cf) { try { n = (parseInt(fs.readFileSync(cf, "utf8"), 10) || 0) + 1; } catch {} fs.writeFileSync(cf, String(n)); }
const exit = parseInt(process.env.FAKE_EXIT || "0", 10);
if (exit) { process.stderr.write("fake failure"); process.exit(exit); }
const out = (n >= 2 && process.env.FAKE_OUT_2 != null) ? process.env.FAKE_OUT_2 : (process.env.FAKE_OUT ?? "");
process.stdout.write(out);
`);
  chmodSync(p, 0o755);
  return p;
}

test("compressText preserves frontmatter verbatim and strips an outer fence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-compress-"));
  try {
    const bin = makeFakeClaude(dir);
    const out = await compressText("---\nname: x\n---\n# H\nlong body text here\n", {
      bin, env: { FAKE_OUT: "```markdown\n# H\nbody\n```" },
    });
    assert.equal(out.valid, true);
    assert.equal(out.changed, true);
    assert.ok(out.compressed.startsWith("---\nname: x\n---\n"), "frontmatter kept verbatim");
    assert.ok(out.compressed.includes("# H\nbody"), "wrapper stripped, heading kept");
    assert.ok(!out.compressed.includes("```markdown"), "no outer fence remains");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compressText reports changed:false when output equals input body", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-compress-"));
  try {
    const bin = makeFakeClaude(dir);
    const out = await compressText("# H\nidentical body\n", { bin, env: { FAKE_OUT: "# H\nidentical body\n" } });
    assert.equal(out.changed, false);
    assert.equal(out.valid, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compressText returns valid:false + reason when claude is missing", async () => {
  const out = await compressText("# H\nbody\n", { bin: "/nonexistent/claude-xyz" });
  assert.equal(out.valid, false);
  assert.match(out.reason, /ENOENT|spawn|not.*found/i);
  assert.equal(out.compressed, "# H\nbody\n"); // untouched
});

test("compressText fails validation when a URL is dropped and stays dropped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-compress-"));
  try {
    const bin = makeFakeClaude(dir);
    const out = await compressText("# H\nsee https://example.com/a\n", {
      bin, env: { FAKE_OUT: "# H\nsee\n" }, // URL dropped, every call
    });
    assert.equal(out.valid, false);
    assert.match(out.reason, /validation failed/i);
    assert.ok(out.errors.some((e) => e.includes("https://example.com/a")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compressText recovers via the fix retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-compress-"));
  try {
    const bin = makeFakeClaude(dir);
    const out = await compressText("# H\nsee https://example.com/a\n", {
      bin,
      env: {
        FAKE_COUNTER: join(dir, "n.txt"),
        FAKE_OUT: "# H\nsee\n",                                  // call 1: drops URL
        FAKE_OUT_2: "# H\nsee https://example.com/a\n",          // call 2 (fix): restores it
      },
    });
    assert.equal(out.valid, true);
    assert.equal(out.changed, true);
    assert.ok(out.compressed.includes("https://example.com/a"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compressText refuses empty and oversized input", async () => {
  const empty = await compressText("   \n  ");
  assert.equal(empty.valid, false);
  assert.match(empty.reason, /empty/i);
  const big = await compressText("#".repeat(500001));
  assert.equal(big.valid, false);
  assert.match(big.reason, /too large/i);
});
