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
  isExcludedPath,
  parseRtkPrefix,
  resolveTsconfig,
  looksLikeSolutionStyleTsconfig,
  tsBuildInfoPathFor,
  hasProjectYamllintConfig,
  hasProjectMarkdownlintConfig,
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

test("REGISTRY: css chain of 1 (stylelint), carries npmSpec", () => {
  assert.equal(REGISTRY.css.chain.length, 1);
  assert.equal(REGISTRY.css.chain[0].name, "stylelint");
  assert.equal(REGISTRY.css.chain[0].npmSpec, "stylelint");
});

test("classifyExit: stylelint is 0-clean/2-issues/else-skip (NOT the shared 0/1/else contract)", () => {
  assert.equal(classifyExit("stylelint", 0), "clean");
  assert.equal(classifyExit("stylelint", 1), "skip");
  assert.equal(classifyExit("stylelint", 2), "issues");
  assert.equal(classifyExit("stylelint", 64), "skip");
  assert.equal(classifyExit("stylelint", 78), "skip");
});

test("classifyExit: tsc shares stylelint's 0-clean/2-issues/else-skip contract (empirically verified, NOT the ExitStatus-enum-derived 0/1/else)", () => {
  assert.equal(classifyExit("tsc", 0), "clean");
  assert.equal(classifyExit("tsc", 1), "skip");
  assert.equal(classifyExit("tsc", 2), "issues");
});

test("resolveTsconfig: finds tsconfig.json walking up to cwd", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ul-ts-"));
  writeFileSync(
    path.join(root, "tsconfig.json"),
    '{"compilerOptions":{},"include":["*.ts"]}',
  );
  const sub = path.join(root, "src");
  mkdirSync(sub, { recursive: true });
  assert.equal(resolveTsconfig(sub, root), path.join(root, "tsconfig.json"));
});

test("resolveTsconfig: nothing found -> null", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ul-ts-"));
  assert.equal(resolveTsconfig(dir, dir), null);
});

test("resolveTsconfig: solution-style tsconfig (references, no files/include) is skipped, keeps walking, -> null when nothing else found", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ul-ts-"));
  writeFileSync(
    path.join(root, "tsconfig.json"),
    '{"files":[],"references":[{"path":"./pkg"}]}',
  );
  const sub = path.join(root, "src");
  mkdirSync(sub, { recursive: true });
  assert.equal(resolveTsconfig(sub, root), null);
});

test("resolveTsconfig: solution-style nearer file is skipped in favor of a real one further up", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ul-ts-"));
  writeFileSync(
    path.join(root, "tsconfig.json"),
    '{"compilerOptions":{},"include":["**/*.ts"]}',
  );
  const sub = path.join(root, "pkg");
  mkdirSync(sub, { recursive: true });
  writeFileSync(
    path.join(sub, "tsconfig.json"),
    '{"files":[],"references":[{"path":"./other"}]}',
  );
  assert.equal(resolveTsconfig(sub, root), path.join(root, "tsconfig.json"));
});

test("resolveTsconfig: unreadable tsconfig.json (a directory of that name -> EISDIR) is treated as absent, walk continues upward", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ul-ts-"));
  writeFileSync(
    path.join(root, "tsconfig.json"),
    '{"compilerOptions":{},"include":["*.ts"]}',
  );
  const sub = path.join(root, "pkg");
  // a directory named tsconfig.json: existsSync -> true, readFileSync -> EISDIR
  mkdirSync(path.join(sub, "tsconfig.json"), { recursive: true });
  assert.equal(resolveTsconfig(sub, root), path.join(root, "tsconfig.json"));
});

test("looksLikeSolutionStyleTsconfig: references with no files/include -> true", () => {
  assert.equal(
    looksLikeSolutionStyleTsconfig(
      '{\n  "files": [],\n  "references": [{"path": "./pkg"}]\n}',
    ),
    true,
  );
});

test("looksLikeSolutionStyleTsconfig: references alongside include -> false", () => {
  assert.equal(
    looksLikeSolutionStyleTsconfig(
      '{\n  "include": ["src/**/*.ts"],\n  "references": [{"path": "./pkg"}]\n}',
    ),
    false,
  );
});

test("looksLikeSolutionStyleTsconfig: no references at all -> false", () => {
  assert.equal(
    looksLikeSolutionStyleTsconfig('{\n  "compilerOptions": {}\n}'),
    false,
  );
});

test("looksLikeSolutionStyleTsconfig: a // comment mentioning the literal '\"references\":' text doesn't misclassify a normal default-discovery config (no include/files at all)", () => {
  assert.equal(
    looksLikeSolutionStyleTsconfig(
      '{\n  // mentions "references": here for docs, not a real key\n  "compilerOptions": {}\n}',
    ),
    false,
  );
});

test("looksLikeSolutionStyleTsconfig: a /* */ comment mentioning the literal '\"references\":' text doesn't misclassify a normal default-discovery config", () => {
  assert.equal(
    looksLikeSolutionStyleTsconfig(
      '{\n  /* mentions "references": here for docs */\n  "compilerOptions": {}\n}',
    ),
    false,
  );
});

test("looksLikeSolutionStyleTsconfig: a genuine solution-style config with an unrelated comment is still detected", () => {
  assert.equal(
    looksLikeSolutionStyleTsconfig(
      '{\n  // solution file, compiles nothing directly\n  "files": [],\n  "references": [{"path": "./pkg"}]\n}',
    ),
    true,
  );
});

test("looksLikeSolutionStyleTsconfig: a string value containing // is not misread as a comment start (files array entry survives stripping)", () => {
  assert.equal(
    looksLikeSolutionStyleTsconfig(
      '{\n  "files": ["http://example/a.ts"],\n  "references": [{"path": "./pkg"}]\n}',
    ),
    false, // files has a real non-empty entry -> not solution-style
  );
});

test("tsBuildInfoPathFor: stable for the same tsconfig path, differs for a different one", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ul-ts-"));
  const a = path.join(dir, "tsconfig.json");
  writeFileSync(a, "{}");
  const p1 = tsBuildInfoPathFor(a);
  const p2 = tsBuildInfoPathFor(a);
  assert.equal(p1, p2);
  const otherDir = mkdtempSync(path.join(tmpdir(), "ul-ts-"));
  const b = path.join(otherDir, "tsconfig.json");
  writeFileSync(b, "{}");
  assert.notEqual(p1, tsBuildInfoPathFor(b));
});

test("tsBuildInfoPathFor: respects CLAUDE_PLUGIN_DATA when set", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ul-ts-"));
  const tsconfig = path.join(dir, "tsconfig.json");
  writeFileSync(tsconfig, "{}");
  const dataDir = mkdtempSync(path.join(tmpdir(), "ul-data-"));
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  try {
    const p = tsBuildInfoPathFor(tsconfig);
    assert.ok(p.startsWith(dataDir));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prev;
  }
});

test("tsBuildInfoPathFor: falls back to the OS temp dir (not cwd/'.') when CLAUDE_PLUGIN_DATA is unset -- never lands inside the project tree", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ul-ts-"));
  const tsconfig = path.join(dir, "tsconfig.json");
  writeFileSync(tsconfig, "{}");
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    const p = tsBuildInfoPathFor(tsconfig);
    assert.ok(!p.startsWith(dir), `expected outside ${dir}, got ${p}`);
    assert.ok(p.startsWith(tmpdir()));
  } finally {
    if (prev !== undefined) process.env.CLAUDE_PLUGIN_DATA = prev;
  }
});

test("REGISTRY: yaml/markdown chain entries carry their line-length guard flags", () => {
  assert.equal(REGISTRY.yaml.chain[0].guardYamlLineLength, true);
  assert.equal(REGISTRY.markdown.chain[0].guardMarkdownLineLength, true);
  assert.equal(REGISTRY.markdown.chain[1].guardMarkdownLineLength, true);
});

test("hasProjectYamllintConfig: finds .yamllint directly in cwd", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ul-yl-"));
  writeFileSync(path.join(dir, ".yamllint"), "extends: default\n");
  assert.equal(hasProjectYamllintConfig(dir), true);
});

test("hasProjectYamllintConfig: finds .yamllint.yaml / .yamllint.yml variants", () => {
  const dirA = mkdtempSync(path.join(tmpdir(), "ul-yl-"));
  writeFileSync(path.join(dirA, ".yamllint.yaml"), "extends: default\n");
  assert.equal(hasProjectYamllintConfig(dirA), true);
  const dirB = mkdtempSync(path.join(tmpdir(), "ul-yl-"));
  writeFileSync(path.join(dirB, ".yamllint.yml"), "extends: default\n");
  assert.equal(hasProjectYamllintConfig(dirB), true);
});

test("hasProjectYamllintConfig: nothing found -> false", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ul-yl-"));
  assert.equal(hasProjectYamllintConfig(dir), false);
});

test("hasProjectYamllintConfig: a config in the user's home directory is found (yamllint checks there too before stopping)", () => {
  const fakeHome = mkdtempSync(path.join(tmpdir(), "ul-yl-home-"));
  writeFileSync(path.join(fakeHome, ".yamllint"), "extends: default\n");
  const sub = path.join(fakeHome, "proj");
  mkdirSync(sub, { recursive: true });
  const prevHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    assert.equal(hasProjectYamllintConfig(sub), true);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  }
});

test("hasProjectMarkdownlintConfig: finds a markdownlint-cli2 config", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ul-md-"));
  writeFileSync(path.join(dir, ".markdownlint-cli2.jsonc"), "{}");
  assert.equal(hasProjectMarkdownlintConfig(dir), true);
});

test("hasProjectMarkdownlintConfig: finds a legacy .markdownlint.json walking up from a nested file dir", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ul-md-"));
  writeFileSync(path.join(root, ".markdownlint.json"), "{}");
  const sub = path.join(root, "docs");
  mkdirSync(sub, { recursive: true });
  assert.equal(hasProjectMarkdownlintConfig(sub), true);
});

test("hasProjectMarkdownlintConfig: nothing found -> false", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ul-md-"));
  assert.equal(hasProjectMarkdownlintConfig(dir), false);
});

test("buildArgv: yamllint gets -d line-length-disable override when no project .yamllint exists", () => {
  const yamllint = REGISTRY.yaml.chain[0];
  const dir = mkdtempSync(path.join(tmpdir(), "ul-yl-"));
  assert.deepEqual(buildArgv(yamllint, path.join(dir, "a.yaml"), dir), [
    "-d",
    "{extends: default, rules: {line-length: disable}}",
    path.join(dir, "a.yaml"),
  ]);
});

test("buildArgv: yamllint runs bare when a project .yamllint exists", () => {
  const yamllint = REGISTRY.yaml.chain[0];
  const dir = mkdtempSync(path.join(tmpdir(), "ul-yl-"));
  writeFileSync(path.join(dir, ".yamllint"), "extends: default\n");
  assert.deepEqual(buildArgv(yamllint, path.join(dir, "a.yaml"), dir), [
    path.join(dir, "a.yaml"),
  ]);
});

test("buildArgv: markdownlint-cli2 gets --config <bundled MD013-off file> when no project config exists", () => {
  const markdownlintCli2 = REGISTRY.markdown.chain[0];
  const dir = mkdtempSync(path.join(tmpdir(), "ul-md-"));
  const argv = buildArgv(markdownlintCli2, path.join(dir, "a.md"), dir);
  assert.equal(argv[0], "--config");
  assert.ok(argv[1].endsWith("markdownlint-no-line-length.json"));
  assert.equal(argv[2], path.join(dir, "a.md"));
});

test("buildArgv: markdownlint-cli2 runs bare when a project config exists", () => {
  const markdownlintCli2 = REGISTRY.markdown.chain[0];
  const dir = mkdtempSync(path.join(tmpdir(), "ul-md-"));
  writeFileSync(path.join(dir, ".markdownlint.json"), "{}");
  assert.deepEqual(buildArgv(markdownlintCli2, path.join(dir, "a.md"), dir), [
    path.join(dir, "a.md"),
  ]);
});

test("REGISTRY: php chain is phpstan -> psalm, neither carries npmSpec", () => {
  assert.equal(REGISTRY.php.chain.length, 2);
  assert.equal(REGISTRY.php.chain[0].name, "phpstan");
  assert.equal(REGISTRY.php.chain[0].npmSpec, undefined);
  assert.equal(REGISTRY.php.chain[1].name, "psalm");
  assert.equal(REGISTRY.php.chain[1].npmSpec, undefined);
});

test("classifyExit: phpstan is 0-clean/else-issues (accepted ambiguity, same as go)", () => {
  assert.equal(classifyExit("phpstan", 0), "clean");
  assert.equal(classifyExit("phpstan", 1), "issues");
  assert.equal(classifyExit("phpstan", 2), "issues");
});

test("classifyExit: psalm is 0-clean/2-issues/else-skip (NOT the shared 0/1/else contract)", () => {
  assert.equal(classifyExit("psalm", 0), "clean");
  assert.equal(classifyExit("psalm", 1), "skip");
  assert.equal(classifyExit("psalm", 2), "issues");
  assert.equal(classifyExit("psalm", 3), "skip");
});

test("isExcludedPath: node_modules/vendor/.git segments -> excluded", () => {
  assert.equal(isExcludedPath(path.join("node_modules", "x", "a.sh")), true);
  assert.equal(isExcludedPath(path.join("vendor", "a.php")), true);
  assert.equal(isExcludedPath(path.join(".git", "hooks", "a.sh")), true);
});

test("isExcludedPath: .claude/worktrees and .claude/agent-memory -> excluded", () => {
  assert.equal(
    isExcludedPath(path.join(".claude", "worktrees", "foo", "a.sh")),
    true,
  );
  assert.equal(
    isExcludedPath(path.join(".claude", "agent-memory", "a.md")),
    true,
  );
});

test("isExcludedPath: other .claude/ subtrees (e.g. rules/agents/skills) stay covered", () => {
  assert.equal(isExcludedPath(path.join(".claude", "rules", "a.md")), false);
  assert.equal(isExcludedPath(path.join(".claude", "settings.json")), false);
});

test("isExcludedPath: *.local.* files excluded regardless of location", () => {
  assert.equal(
    isExcludedPath(path.join(".claude", "settings.local.json")),
    true,
  );
  assert.equal(isExcludedPath("docker-compose.local.yml"), true);
  assert.equal(isExcludedPath("a.sh"), false);
});
