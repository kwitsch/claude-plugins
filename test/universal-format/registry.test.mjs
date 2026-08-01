import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildInvocation,
  isToolAvailable,
  REGISTRY,
  hasPrettierProjectConfig,
  guardPrintWidthArgv,
} from "../../plugins/universal-format/hooks/format-file.mjs";

const shfmt = REGISTRY.shell.chain[0];
const gjf = REGISTRY.java.chain[0];
const clang = REGISTRY.java.chain[1];
const biome = REGISTRY.jsts.chain[1];
const ruff = REGISTRY.python.chain[0];
const black = REGISTRY.python.chain[1];

test("native/fixed tools always run bare regardless of editorconfig", () => {
  assert.deepEqual(
    buildInvocation(shfmt, { editorconfig: { indent_style: "tab" } }),
    { argv: ["-w"] },
  );
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
  assert.deepEqual(
    buildInvocation(gjf, { editorconfig: { indent_style: "tab" } }),
    { skip: true },
  );
  assert.deepEqual(buildInvocation(gjf, { editorconfig: { indent_size: 3 } }), {
    skip: true,
  });
  assert.deepEqual(
    buildInvocation(gjf, { editorconfig: { indent_size: "tab" } }),
    { skip: true },
  );
  assert.deepEqual(
    buildInvocation(gjf, { editorconfig: { max_line_length: 80 } }),
    { skip: true },
  );
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
  assert.deepEqual(
    buildInvocation(black, { editorconfig: { indent_style: "tab" } }),
    { skip: true },
  );
  assert.deepEqual(
    buildInvocation(black, { editorconfig: { max_line_length: 100 } }),
    { argv: ["--quiet", "--line-length", "100"] },
  );
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
      argv: [
        "format",
        "--quiet",
        "--line-length",
        "88",
        "--config",
        "format.indent-style='space'",
        "--config",
        "format.indent-width=4",
      ],
    },
  );
});

test("biome: editorconfig maps indent + line ending + width", () => {
  assert.deepEqual(
    buildInvocation(biome, {
      editorconfig: {
        indent_style: "space",
        indent_size: 2,
        end_of_line: "lf",
        max_line_length: 100,
      },
    }),
    {
      argv: [
        "format",
        "--write",
        "--log-level=none",
        "--indent-style=space",
        "--indent-width=2",
        "--line-ending=lf",
        "--line-width=100",
      ],
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
      argv: [
        "-i",
        "--style={BasedOnStyle: Google, IndentWidth: 2, UseTab: Never, ColumnLimit: 100}",
      ],
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

test("REGISTRY: only prettier/biome carry npmSpec, with the exact npm package names", () => {
  assert.equal(REGISTRY.jsts.chain[0].npmSpec, "prettier");
  assert.equal(REGISTRY.jsts.chain[1].npmSpec, "@biomejs/biome");
  for (const lang of ["shell", "java", "kotlin", "python", "go"]) {
    for (const tool of REGISTRY[lang].chain) {
      assert.equal(tool.npmSpec, undefined);
    }
  }
});

test("REGISTRY: json/yaml/markdown chains and npmSpecs", () => {
  assert.deepEqual(
    REGISTRY.json.chain.map((t) => t.name),
    ["prettier", "biome"],
  );
  assert.equal(REGISTRY.json.chain[0].npmSpec, "prettier");
  assert.equal(REGISTRY.json.chain[1].npmSpec, "@biomejs/biome");
  assert.deepEqual(
    REGISTRY.yaml.chain.map((t) => t.name),
    ["prettier"],
  );
  assert.equal(REGISTRY.yaml.chain[0].npmSpec, "prettier");
  assert.deepEqual(
    REGISTRY.markdown.chain.map((t) => t.name),
    ["prettier"],
  );
  assert.equal(REGISTRY.markdown.chain[0].npmSpec, "prettier");
});

test("REGISTRY: css/scss chains -- css is prettier+biome (like json), scss is prettier-only (biome excludes SCSS syntax)", () => {
  assert.deepEqual(
    REGISTRY.css.chain.map((t) => t.name),
    ["prettier", "biome"],
  );
  assert.equal(REGISTRY.css.chain[0].npmSpec, "prettier");
  assert.equal(REGISTRY.css.chain[1].npmSpec, "@biomejs/biome");
  assert.deepEqual(
    REGISTRY.scss.chain.map((t) => t.name),
    ["prettier"],
  );
  assert.equal(REGISTRY.scss.chain[0].npmSpec, "prettier");
});

test("json: biome chain entry is mapped (not native) -- editorconfig applies only when biome.json is absent", () => {
  const biomeJson = REGISTRY.json.chain[1];
  assert.equal(biomeJson.strategy, "mapped");
  assert.deepEqual(
    buildInvocation(biomeJson, {
      editorconfig: { indent_style: "space", indent_size: 2 },
    }),
    {
      argv: [
        "format",
        "--write",
        "--log-level=none",
        "--indent-style=space",
        "--indent-width=2",
      ],
    },
  );
  assert.deepEqual(buildInvocation(biomeJson, { hasNativeConfig: true }), {
    argv: ["format", "--write", "--log-level=none"],
  });
});

test("isToolAvailable: true when the tool itself is on PATH", () => {
  assert.equal(isToolAvailable({ name: "shfmt" }, true, false), true);
  assert.equal(
    isToolAvailable({ name: "prettier", npmSpec: "prettier" }, true, false),
    true,
  );
});

test("isToolAvailable: true via npx only when npmSpec is set and npx is on PATH", () => {
  assert.equal(
    isToolAvailable({ name: "prettier", npmSpec: "prettier" }, false, true),
    true,
  );
  assert.equal(
    isToolAvailable({ name: "prettier", npmSpec: "prettier" }, false, false),
    false,
  );
  assert.equal(isToolAvailable({ name: "shfmt" }, false, true), false);
});

test("isToolAvailable: false when neither PATH nor npx-with-npmSpec applies", () => {
  assert.equal(isToolAvailable({ name: "shfmt" }, false, false), false);
});

test("REGISTRY: yaml/json prettier entries carry guardPrintWidth; css/scss/markdown do not", () => {
  assert.equal(REGISTRY.yaml.chain[0].guardPrintWidth, true);
  assert.equal(REGISTRY.json.chain[0].guardPrintWidth, true);
  assert.equal(REGISTRY.json.chain[0].name, "prettier");
  assert.equal(REGISTRY.css.chain[0].guardPrintWidth, undefined);
  assert.equal(REGISTRY.scss.chain[0].guardPrintWidth, undefined);
  assert.equal(REGISTRY.markdown.chain[0].guardPrintWidth, undefined);
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
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", prettier: { printWidth: 100 } }),
  );
  assert.equal(hasPrettierProjectConfig(dir), true);
});

test('hasPrettierProjectConfig: package.json WITHOUT a top-level "prettier" key does not count -- devDependencies listing prettier is not a config', () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-pc-"));
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", devDependencies: { prettier: "^3.9.0" } }),
  );
  assert.equal(hasPrettierProjectConfig(dir), false);
});

test('hasPrettierProjectConfig: top-level "prettier" key in package.yaml counts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-pc-"));
  writeFileSync(
    path.join(dir, "package.yaml"),
    "name: x\nprettier:\n  printWidth: 100\n",
  );
  assert.equal(hasPrettierProjectConfig(dir), true);
});

test("hasPrettierProjectConfig: nothing found -> false", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-pc-"));
  assert.equal(hasPrettierProjectConfig(dir), false);
});

test("guardPrintWidthArgv: no prettier config, no .editorconfig -> --print-width appended", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-pw-"));
  const file = path.join(dir, "a.yaml");
  assert.deepEqual(guardPrintWidthArgv(["--write"], file, dir), [
    "--write",
    "--print-width",
    "99999",
  ]);
});

test("guardPrintWidthArgv: prettier project config present -> bare, no override", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-pw-"));
  writeFileSync(path.join(dir, ".prettierrc"), "{}");
  const file = path.join(dir, "a.yaml");
  assert.deepEqual(guardPrintWidthArgv(["--write"], file, dir), ["--write"]);
});

test("guardPrintWidthArgv: .editorconfig sets max_line_length -> bare, prettier honors it natively", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-pw-"));
  writeFileSync(
    path.join(dir, ".editorconfig"),
    "root = true\n[*]\nmax_line_length = 100\n",
  );
  const file = path.join(dir, "a.json");
  assert.deepEqual(guardPrintWidthArgv(["--write"], file, dir), ["--write"]);
});

test("guardPrintWidthArgv: .editorconfig present but without max_line_length -> override still applies", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-pw-"));
  writeFileSync(
    path.join(dir, ".editorconfig"),
    "root = true\n[*]\nindent_size = 2\n",
  );
  const file = path.join(dir, "a.json");
  assert.deepEqual(guardPrintWidthArgv(["--write"], file, dir), [
    "--write",
    "--print-width",
    "99999",
  ]);
});

test("REGISTRY: php chain is php-cs-fixer -> phpcbf, both native strategy, no npmSpec", () => {
  assert.equal(REGISTRY.php.chain.length, 2);
  assert.equal(REGISTRY.php.chain[0].name, "php-cs-fixer");
  assert.equal(REGISTRY.php.chain[0].strategy, "native");
  assert.equal(REGISTRY.php.chain[0].npmSpec, undefined);
  assert.equal(REGISTRY.php.chain[1].name, "phpcbf");
  assert.equal(REGISTRY.php.chain[1].strategy, "native");
  assert.equal(REGISTRY.php.chain[1].npmSpec, undefined);
});
