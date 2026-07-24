import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  REGISTRY,
  resolveCheckstyleConfig,
  buildArgv,
  classifyExit,
  classifyCheckstyleOutput,
  truncate,
  isToolAvailable,
  parseRtkPrefix,
} from "../../plugins/universal-lint/hooks/lint-file.mjs";

const shellcheck = REGISTRY.shell.chain[0];
const checkstyle = REGISTRY.java.chain[0];
const ruff = REGISTRY.python.chain[0];
const golangciLint = REGISTRY.go.chain[0];
const goVet = REGISTRY.go.chain[1];

test("REGISTRY: chain of 1 for five languages, chain of 2 for go", () => {
  assert.equal(REGISTRY.shell.chain.length, 1);
  assert.equal(REGISTRY.java.chain.length, 1);
  assert.equal(REGISTRY.kotlin.chain.length, 1);
  assert.equal(REGISTRY.jsts.chain.length, 1);
  assert.equal(REGISTRY.python.chain.length, 1);
  assert.equal(REGISTRY.go.chain.length, 2);
  assert.equal(golangciLint.name, "golangci-lint");
  assert.equal(goVet.name, "go");
});

test("no chain entry ever carries a --fix/--format/--write-equivalent flag", () => {
  const banned = /^--?(fix|format|write|replace)$/i;
  for (const lang of Object.values(REGISTRY)) {
    for (const tool of lang.chain) {
      assert.ok(
        tool.args.every((a) => !banned.test(a)),
        `${tool.name} args ${JSON.stringify(tool.args)} contain a fix/format flag`,
      );
    }
  }
});

test("buildArgv: plain tool appends the resolved file last", () => {
  assert.deepEqual(buildArgv(shellcheck, "/proj/a.sh", "/proj"), [
    "/proj/a.sh",
  ]);
});

test("buildArgv: ruff check keeps its subcommand before the file", () => {
  assert.deepEqual(buildArgv(ruff, "/proj/a.py", "/proj"), [
    "check",
    "/proj/a.py",
  ]);
});

test("buildArgv: go entries target the directory, not the file", () => {
  assert.deepEqual(buildArgv(goVet, "/proj/pkg/a.go", "/proj"), [
    "vet",
    "/proj/pkg",
  ]);
  assert.deepEqual(buildArgv(golangciLint, "/proj/pkg/a.go", "/proj"), [
    "run",
    "/proj/pkg",
  ]);
});

test("buildArgv: checkstyle injects -c <resolved config> before the file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ul-cs-"));
  assert.deepEqual(buildArgv(checkstyle, path.join(dir, "A.java"), dir), [
    "-c",
    "/google_checks.xml",
    path.join(dir, "A.java"),
  ]);
});

test("resolveCheckstyleConfig: finds checkstyle.xml walking up to cwd", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ul-cs-"));
  writeFileSync(path.join(root, "checkstyle.xml"), '<module name="Checker"/>');
  const sub = path.join(root, "src", "main");
  mkdirSync(sub, { recursive: true });
  assert.equal(
    resolveCheckstyleConfig(sub, root),
    path.join(root, "checkstyle.xml"),
  );
});

test("resolveCheckstyleConfig: finds config/checkstyle/checkstyle.xml", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ul-cs-"));
  mkdirSync(path.join(root, "config", "checkstyle"), { recursive: true });
  writeFileSync(
    path.join(root, "config", "checkstyle", "checkstyle.xml"),
    '<module name="Checker"/>',
  );
  assert.equal(
    resolveCheckstyleConfig(root, root),
    path.join(root, "config", "checkstyle", "checkstyle.xml"),
  );
});

test("resolveCheckstyleConfig: nothing found -> null", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ul-cs-"));
  assert.equal(resolveCheckstyleConfig(dir, dir), null);
});

test("classifyExit: shellcheck/ktlint/eslint/ruff/golangci-lint/yamllint/markdownlint-cli2/markdownlint share the 0-clean/1-issues/else-skip contract", () => {
  for (const name of [
    "shellcheck",
    "ktlint",
    "eslint",
    "ruff",
    "golangci-lint",
    "yamllint",
    "markdownlint-cli2",
    "markdownlint",
  ]) {
    assert.equal(classifyExit(name, 0), "clean");
    assert.equal(classifyExit(name, 1), "issues");
    assert.equal(classifyExit(name, 2), "skip");
  }
});

test("classifyExit: go (go vet) is clean-vs-nonzero only, no skip bucket", () => {
  assert.equal(classifyExit("go", 0), "clean");
  assert.equal(classifyExit("go", 1), "issues");
  assert.equal(classifyExit("go", 2), "issues");
});

test("classifyExit: null status (signal-killed) always skips, any tool", () => {
  assert.equal(classifyExit("eslint", null), "skip");
  assert.equal(classifyExit("go", null), "skip");
});

test("classifyExit: unknown tool name skips", () => {
  assert.equal(classifyExit("mystery-tool", 0), "skip");
});

test("classifyCheckstyleOutput: boilerplate only -> clean", () => {
  const r = classifyCheckstyleOutput("Starting audit...\nAudit done.\n");
  assert.equal(r.status, "clean");
  assert.equal(r.text, "");
});

test("classifyCheckstyleOutput: boilerplate + violation lines -> issues (exit-code-independent)", () => {
  const r = classifyCheckstyleOutput(
    "Starting audit...\n[WARN] /proj/A.java:3: Missing a Javadoc comment. [JavadocType]\nAudit done.\n",
  );
  assert.equal(r.status, "issues");
  assert.match(r.text, /JavadocType/);
});

test("classifyCheckstyleOutput: no trailing 'Audit done.' -> skip (crash/misconfig)", () => {
  const r = classifyCheckstyleOutput(
    'Exception in thread "main" java.lang.RuntimeException\n',
  );
  assert.equal(r.status, "skip");
});

test("truncate: short text passes through unchanged (trimmed)", () => {
  assert.equal(truncate("  hello\n"), "hello");
});

test("truncate: collapses 3+ blank lines to 1", () => {
  assert.equal(truncate("a\n\n\n\nb"), "a\n\nb");
});

test("truncate: caps at MAX_CONTEXT_CHARS and marks truncation", () => {
  const long = "x".repeat(5000);
  const out = truncate(long);
  assert.ok(out.length < long.length);
  assert.ok(out.endsWith("… (truncated)"));
});

test("REGISTRY: npmSpec carried by eslint (jsts) and both markdown tools; not by yaml/shell/java/kotlin/python/go", () => {
  assert.equal(REGISTRY.jsts.chain[0].npmSpec, "eslint");
  assert.equal(REGISTRY.markdown.chain[0].npmSpec, "markdownlint-cli2");
  assert.equal(REGISTRY.markdown.chain[1].npmSpec, "markdownlint-cli");
  for (const lang of ["shell", "java", "kotlin", "python", "go", "yaml"]) {
    for (const tool of REGISTRY[lang].chain) {
      assert.equal(tool.npmSpec, undefined);
    }
  }
});

test("REGISTRY: chain of 1 for yaml (yamllint), chain of 2 for markdown (cli2 -> cli); no json entry", () => {
  assert.equal(REGISTRY.yaml.chain.length, 1);
  assert.equal(REGISTRY.yaml.chain[0].name, "yamllint");
  assert.equal(REGISTRY.markdown.chain.length, 2);
  assert.equal(REGISTRY.markdown.chain[0].name, "markdownlint-cli2");
  assert.equal(REGISTRY.markdown.chain[1].name, "markdownlint");
  assert.equal(REGISTRY.json, undefined);
});

test("isToolAvailable: true when the tool itself is on PATH", () => {
  assert.equal(
    isToolAvailable({ name: "shellcheck", args: [] }, true, false),
    true,
  );
  assert.equal(
    isToolAvailable(
      { name: "eslint", args: [], npmSpec: "eslint" },
      true,
      false,
    ),
    true,
  );
});

test("isToolAvailable: true via npx only when npmSpec is set and npx is on PATH", () => {
  assert.equal(
    isToolAvailable(
      { name: "eslint", args: [], npmSpec: "eslint" },
      false,
      true,
    ),
    true,
  );
  assert.equal(
    isToolAvailable(
      { name: "eslint", args: [], npmSpec: "eslint" },
      false,
      false,
    ),
    false,
  );
  assert.equal(
    isToolAvailable({ name: "shellcheck", args: [] }, false, true),
    false,
  );
});

test("parseRtkPrefix: extracts a single-token verb (eslint -> lint)", () => {
  assert.deepEqual(parseRtkPrefix("rtk lint __RTK_PROBE__\n"), ["lint"]);
});

test("parseRtkPrefix: extracts a multi-token verb (go vet)", () => {
  assert.deepEqual(parseRtkPrefix("rtk go vet __RTK_PROBE__"), ["go", "vet"]);
});

test("parseRtkPrefix: same-name verb (ruff check)", () => {
  assert.deepEqual(parseRtkPrefix("rtk ruff check __RTK_PROBE__"), [
    "ruff",
    "check",
  ]);
});

test("parseRtkPrefix: empty stdout (no rtk equivalent, e.g. checkstyle/ktlint) -> null", () => {
  assert.equal(parseRtkPrefix(""), null);
  assert.equal(parseRtkPrefix("\n"), null);
});

test("parseRtkPrefix: unexpected output -> null", () => {
  assert.equal(parseRtkPrefix("something unexpected"), null);
  assert.equal(parseRtkPrefix("rtk __RTK_PROBE__"), null); // empty prefix
});

test("REGISTRY: scss chain of 1 (stylelint), carries npmSpec", () => {
  assert.equal(REGISTRY.scss.chain.length, 1);
  assert.equal(REGISTRY.scss.chain[0].name, "stylelint");
  assert.equal(REGISTRY.scss.chain[0].npmSpec, "stylelint");
});

test("classifyExit: stylelint is 0-clean/2-issues/else-skip (NOT the shared 0/1/else contract)", () => {
  assert.equal(classifyExit("stylelint", 0), "clean");
  assert.equal(classifyExit("stylelint", 1), "skip");
  assert.equal(classifyExit("stylelint", 2), "issues");
  assert.equal(classifyExit("stylelint", 64), "skip");
  assert.equal(classifyExit("stylelint", 78), "skip");
});
