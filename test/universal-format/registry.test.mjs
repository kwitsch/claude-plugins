import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildInvocation, isExcludedPath, REGISTRY, EXT_MAP, PRETTIER_LANGS, hasPrettierProjectConfig, shouldOverridePrintWidth } from "../../plugins/universal-format/mcp/server.mjs";

const shfmt = REGISTRY.shell.chain[0];
const gjf = REGISTRY.java.chain[0];
const clang = REGISTRY.java.chain[1];
const ruff = REGISTRY.python.chain[0];
const black = REGISTRY.python.chain[1];

test("native/fixed tools always run bare regardless of editorconfig", () => {
  assert.deepEqual(buildInvocation(shfmt, { editorconfig: { indent_style: "tab" } }), { argv: ["-w"] });
});

test("google-java-format: indent_size 4 -> --aosp", () => {
  assert.deepEqual(buildInvocation(gjf, { editorconfig: { indent_size: 4 } }), {
    argv: ["--aosp", "--replace"],
  });
});

test("google-java-format: indent_size 2 or no editorconfig -> bare", () => {
  assert.deepEqual(buildInvocation(gjf, { editorconfig: { indent_size: 2 } }), {
    argv: ["--replace"],
  });
  assert.deepEqual(buildInvocation(gjf, { editorconfig: null }), {
    argv: ["--replace"],
  });
});

test("google-java-format: hard conflicts skip (tab, odd indent, narrow columns)", () => {
  assert.deepEqual(buildInvocation(gjf, { editorconfig: { indent_style: "tab" } }), { skip: true });
  assert.deepEqual(buildInvocation(gjf, { editorconfig: { indent_size: 3 } }), {
    skip: true,
  });
  assert.deepEqual(buildInvocation(gjf, { editorconfig: { indent_size: "tab" } }), { skip: true });
  assert.deepEqual(buildInvocation(gjf, { editorconfig: { max_line_length: 80 } }), { skip: true });
});

test("google-java-format: native config beats editorconfig -> bare", () => {
  assert.deepEqual(
    buildInvocation(gjf, {
      hasNativeConfig: true,
      editorconfig: { indent_style: "tab" },
    }),
    { argv: ["--replace"] },
  );
});

test("black: tab indent skips; max_line_length maps", () => {
  assert.deepEqual(buildInvocation(black, { editorconfig: { indent_style: "tab" } }), { skip: true });
  assert.deepEqual(buildInvocation(black, { editorconfig: { max_line_length: 100 } }), { argv: ["--quiet", "--line-length", "100"] });
});

test("ruff: editorconfig maps line length + indent style/width", () => {
  assert.deepEqual(
    buildInvocation(ruff, {
      editorconfig: {
        max_line_length: 88,
        indent_style: "space",
        indent_size: 4,
      },
    }),
    {
      argv: ["format", "--quiet", "--line-length", "88", "--config", "format.indent-style='space'", "--config", "format.indent-width=4"],
    },
  );
});

test("clang-format: editorconfig builds an explicit Google-based style", () => {
  assert.deepEqual(
    buildInvocation(clang, {
      editorconfig: {
        indent_size: 2,
        indent_style: "space",
        max_line_length: 100,
      },
    }),
    {
      argv: ["-i", "--style={BasedOnStyle: Google, IndentWidth: 2, UseTab: Never, ColumnLimit: 100}"],
    },
  );
});

test("clang-format: native config -> bare (fallback ignored when .clang-format present)", () => {
  assert.deepEqual(
    buildInvocation(clang, {
      hasNativeConfig: true,
      editorconfig: { indent_size: 2 },
    }),
    { argv: ["-i", "--style=file", "--fallback-style=Google"] },
  );
});

// Tripwire 1 (inverse of the old "only prettier carries npmSpec" test): prettier is not in
// REGISTRY at all any more, and no surviving chain tool ever carried npmSpec or guardPrintWidth.
// Existence checks only — `tool.npmSpec` would be a TS2339 typecheck failure.
test("REGISTRY: no chain tool carries npmSpec or guardPrintWidth", () => {
  for (const entry of Object.values(REGISTRY)) {
    for (const tool of entry.chain) {
      assert.equal("npmSpec" in tool, false, `${tool.name} must not carry npmSpec`);
      assert.equal("guardPrintWidth" in tool, false, `${tool.name} must not carry guardPrintWidth`);
    }
  }
});

// Tripwire 2: EXT_MAP partitions exactly — every mapped language is either owned by the bundled
// prettier (format_pre) or has a CLI chain in REGISTRY (format_post), never both and never
// neither. This is the unit-level pin for formatPost's REGISTRY[lang] existence guard.
test("EXT_MAP partitions exactly into PRETTIER_LANGS and REGISTRY keys", () => {
  for (const lang of Object.values(EXT_MAP)) {
    assert.equal(PRETTIER_LANGS.has(lang) !== Object.hasOwn(REGISTRY, lang), true, `${lang} must be in exactly one of PRETTIER_LANGS / REGISTRY`);
  }
  for (const lang of PRETTIER_LANGS) {
    assert.equal(Object.hasOwn(REGISTRY, lang), false, `${lang} must not have a REGISTRY chain`);
  }
});

test("hasPrettierProjectConfig: finds .prettierrc directly in the file's dir", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-pc-"));
  writeFileSync(path.join(dir, ".prettierrc"), "{}");
  assert.equal(hasPrettierProjectConfig(dir), true);
});

test("hasPrettierProjectConfig: finds prettier.config.mjs walking up from a nested file dir", () => {
  const root = mkdtempSync(path.join(tmpdir(), "uf-pc-"));
  writeFileSync(path.join(root, "prettier.config.mjs"), "export default {};");
  const sub = path.join(root, "src", "deep");
  mkdirSync(sub, { recursive: true });
  assert.equal(hasPrettierProjectConfig(sub), true);
});

test('hasPrettierProjectConfig: top-level "prettier" key in package.json counts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-pc-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", prettier: { printWidth: 100 } }));
  assert.equal(hasPrettierProjectConfig(dir), true);
});

test('hasPrettierProjectConfig: package.json WITHOUT a top-level "prettier" key does not count -- devDependencies listing prettier is not a config', () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-pc-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", devDependencies: { prettier: "^3.9.0" } }));
  assert.equal(hasPrettierProjectConfig(dir), false);
});

test('hasPrettierProjectConfig: top-level "prettier" key in package.yaml counts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-pc-"));
  writeFileSync(path.join(dir, "package.yaml"), "name: x\nprettier:\n  printWidth: 100\n");
  assert.equal(hasPrettierProjectConfig(dir), true);
});

test("hasPrettierProjectConfig: nothing found -> false", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-pc-"));
  assert.equal(hasPrettierProjectConfig(dir), false);
});

test("REGISTRY: php chain is php-cs-fixer only (chain of 1), native strategy, caching disabled", () => {
  assert.equal(REGISTRY.php.chain.length, 1);
  assert.equal(REGISTRY.php.chain[0].name, "php-cs-fixer");
  assert.equal(REGISTRY.php.chain[0].strategy, "native");
  assert.ok(REGISTRY.php.chain[0].base.includes("--using-cache=no"));
});

test("isExcludedPath: node_modules/vendor/.git segments -> excluded", () => {
  assert.equal(isExcludedPath(path.join("node_modules", "x", "a.sh")), true);
  assert.equal(isExcludedPath(path.join("vendor", "a.php")), true);
  assert.equal(isExcludedPath(path.join(".git", "hooks", "a.sh")), true);
});

test("isExcludedPath: .claude/worktrees and .claude/agent-memory -> excluded", () => {
  assert.equal(isExcludedPath(path.join(".claude", "worktrees", "foo", "a.sh")), true);
  assert.equal(isExcludedPath(path.join(".claude", "agent-memory", "a.md")), true);
});

test("isExcludedPath: other .claude/ subtrees (e.g. rules/agents/skills) stay covered", () => {
  assert.equal(isExcludedPath(path.join(".claude", "rules", "a.md")), false);
  assert.equal(isExcludedPath(path.join(".claude", "settings.json")), false);
});

test("isExcludedPath: a later .claude segment matching worktrees/agent-memory is still excluded, even after an earlier non-matching .claude segment", () => {
  assert.equal(isExcludedPath(path.join(".claude", "rules", ".claude", "worktrees", "foo", "a.sh")), true);
  assert.equal(isExcludedPath(path.join(".claude", "skills", ".claude", "agent-memory", "a.md")), true);
});

test("isExcludedPath: *.local.* files excluded regardless of location", () => {
  assert.equal(isExcludedPath(path.join(".claude", "settings.local.json")), true);
  assert.equal(isExcludedPath("docker-compose.local.yml"), true);
  assert.equal(isExcludedPath("a.sh"), false);
});

test("shouldOverridePrintWidth: no config -> true", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-sopw-a-"));
  assert.equal(shouldOverridePrintWidth(path.join(dir, "a.json"), dir), true);
});

test("shouldOverridePrintWidth: .prettierrc -> false", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-sopw-b-"));
  writeFileSync(path.join(dir, ".prettierrc"), "{}");
  assert.equal(shouldOverridePrintWidth(path.join(dir, "a.json"), dir), false);
});

test("shouldOverridePrintWidth: .editorconfig max_line_length -> false", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-sopw-c-"));
  writeFileSync(path.join(dir, ".editorconfig"), "root = true\n[*]\nmax_line_length = 100\n");
  assert.equal(shouldOverridePrintWidth(path.join(dir, "a.json"), dir), false);
});
