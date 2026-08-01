import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripHtmlComments, buildResult } from "../../plugins/kiwi-code-style/hooks/inject-ponytail-guidelines.mjs";

const GUIDELINES_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../plugins/kiwi-code-style/hooks/ponytail-guidelines.md");

test("stripHtmlComments: removes HTML comments and leading blank lines", () => {
  const raw = "<!-- note -->\n\n# Heading\ntext";
  assert.equal(stripHtmlComments(raw), "# Heading\ntext");
});

test("stripHtmlComments: passes text with no comments through unchanged", () => {
  assert.equal(stripHtmlComments("# Heading\ntext"), "# Heading\ntext");
});

test("buildResult: wraps stripped guidelines in the SessionStart hook shape", () => {
  const raw = "<!-- x -->\n\nbody text";
  assert.deepEqual(buildResult(raw), {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: "body text",
    },
  });
});

test("bundled ponytail-guidelines.md strips clean and keeps all 5 sections", () => {
  const raw = readFileSync(GUIDELINES_PATH, "utf8");
  const ctx = buildResult(raw).hookSpecificOutput?.additionalContext ?? "";
  assert.ok(ctx.length > 0);
  assert.ok(!ctx.includes("<!--"));
  assert.ok(!ctx.includes("prettier-ignore"));
  assert.ok(!ctx.includes("Source:"));
  assert.ok(ctx.includes("## 1. Think Before Coding"));
  assert.ok(ctx.includes("## 2. Simplicity"));
  assert.ok(ctx.includes("## 3. Surgical Changes"));
  assert.ok(ctx.includes("## 4. Bug Fixes"));
  assert.ok(ctx.includes("## 5. Goal-Driven Execution"));
});
