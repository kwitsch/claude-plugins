import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildInvocation, cargoEdition, isExcludedPath, REGISTRY, EXT_MAP, PRETTIER_LANGS, hasPrettierProjectConfig, selectFormatter, shouldOverridePrintWidth } from "../../plugins/universal-format/mcp/server.mjs";
import { chmodSync } from "node:fs";

const gofmt = REGISTRY.go.chain[1];
const ruff = REGISTRY.python.chain[0];
const black = REGISTRY.python.chain[1];

test("native/fixed tools always run bare regardless of editorconfig (and never carry an in-place flag: the content travels on stdin)", () => {
  assert.deepEqual(buildInvocation(gofmt, { editorconfig: { indent_style: "tab" } }), { argv: [] });
});

// Every chain tool must be able to run in stdin mode: the handler never writes the file itself, so
// a tool without a stdin tail could only ever be a no-op. The tail names the real file so project
// config (pyproject.toml, .editorconfig, a Go module) resolves as for the file on disk.
test("REGISTRY: every chain tool declares stdinArgs, and selectFormatter appends them after the mapped flags", () => {
  for (const entry of Object.values(REGISTRY)) {
    for (const tool of entry.chain) assert.equal(typeof tool.stdinArgs, "function", `${tool.name} must declare stdinArgs`);
  }
  assert.deepEqual(REGISTRY.kotlin.chain[0].okExit, [0, 1], "ktlint exits 1 after a successful format when unfixable violations remain");
  assert.equal(REGISTRY.rust.chain[0].spawnCwd, "fileDir", "rustfmt finds rustfmt.toml by walking up from cwd, so cwd must be the file's directory");

  const bin = mkdtempSync(path.join(tmpdir(), "uf-sel-bin-"));
  for (const name of ["ruff", "gofmt", "rustfmt"]) {
    writeFileSync(path.join(bin, name), "#!/bin/sh\ncat\n");
    chmodSync(path.join(bin, name), 0o755);
  }
  const proj = mkdtempSync(path.join(tmpdir(), "uf-sel-proj-"));
  writeFileSync(path.join(proj, ".editorconfig"), "root = true\n[*]\nmax_line_length = 88\n");
  const originalPath = process.env.PATH;
  process.env.PATH = bin; // onPath caches per tool name for the process lifetime: this is the only PATH probe in this file
  try {
    const py = selectFormatter(REGISTRY.python.chain, path.join(proj, "a.py"), proj);
    assert.deepEqual(py?.argv, ["format", "--quiet", "--line-length", "88", "--stdin-filename", path.join(proj, "a.py"), "-"]);
    const go = selectFormatter(REGISTRY.go.chain, path.join(proj, "a.go"), proj);
    assert.equal(go?.tool.name, "gofmt", "goimports is not on PATH, so the chain falls through to gofmt");
    assert.deepEqual(go?.argv, []);
    writeFileSync(path.join(proj, "Cargo.toml"), '[package]\nname = "x"\nedition = "2021"\n');
    const rs = selectFormatter(REGISTRY.rust.chain, path.join(proj, "a.rs"), proj);
    assert.deepEqual(rs?.argv, ["--config", "max_width=88", "--edition", "2021"], "mapped flags, then the Cargo.toml edition, then the (empty) stdin tail");
  } finally {
    process.env.PATH = originalPath;
  }
});

// rustfmt parses stdin as Rust 2015 unless told otherwise, so the crate's edition is what `cargo fmt`
// would pass: the nearest Cargo.toml stating one, walking up to the project base for a crate that
// inherits `edition.workspace = true` from its workspace root.
test("cargoEdition: nearest literal wins, workspace inheritance walks up, none -> empty", () => {
  const root = mkdtempSync(path.join(tmpdir(), "uf-cargo-"));
  const crate = path.join(root, "crates", "a", "src");
  mkdirSync(crate, { recursive: true });
  assert.equal(cargoEdition(crate, root), "", "no manifest anywhere");
  writeFileSync(path.join(root, "Cargo.toml"), '[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nedition = "2024"\n');
  writeFileSync(path.join(root, "crates", "a", "Cargo.toml"), '[package]\nname = "a"\nedition.workspace = true\n');
  assert.equal(cargoEdition(crate, root), "2024", "inherited: the crate manifest has no literal, the workspace root does");
  writeFileSync(path.join(root, "crates", "a", "Cargo.toml"), '[package]\nname = "a"\nedition = "2018"\n');
  assert.equal(cargoEdition(crate, root), "2018", "the nearest literal wins");
  assert.equal(cargoEdition(crate, path.join(root, "crates", "a")), "2018", "bounded at base (inclusive)");
  assert.equal(cargoEdition(path.join(root, "crates"), path.join(root, "crates")), "", "bounded: never looks above base");
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
      argv: ["format", "--quiet", "--line-length", "88", "--config", "format.indent-style='space'", "--config", "indent-width=4"],
    },
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
// prettier (in-process) or has a CLI chain in REGISTRY (stdin), never both and never neither. This
// is the unit-level pin for formatPre's dispatch (PRETTIER_LANGS first, then REGISTRY[lang]).
test("EXT_MAP partitions exactly into PRETTIER_LANGS and REGISTRY keys", () => {
  for (const lang of Object.values(EXT_MAP)) {
    assert.equal(PRETTIER_LANGS.has(lang) !== Object.hasOwn(REGISTRY, lang), true, `${lang} must be in exactly one of PRETTIER_LANGS / REGISTRY`);
  }
  for (const lang of PRETTIER_LANGS) {
    assert.equal(Object.hasOwn(REGISTRY, lang), false, `${lang} must not have a REGISTRY chain`);
  }
});

// Tripwire 3: every PRETTIER_LANGS member is reachable from at least one EXT_MAP entry. The
// partition test above iterates EXT_MAP *values* only, so it structurally cannot catch a
// PRETTIER_LANGS member added without its extension -- a language that would then never dispatch.
test("every PRETTIER_LANGS member is reachable from at least one EXT_MAP extension", () => {
  const mapped = new Set(Object.values(EXT_MAP));
  for (const lang of PRETTIER_LANGS) {
    assert.equal(mapped.has(lang), true, `${lang} is in PRETTIER_LANGS but no EXT_MAP extension maps to it`);
  }
});

// Tripwire 4: REGISTRY holds exactly the four languages with no viable prettier plugin (surveyed:
// kotlin's only plugin shells out to a bundled 39.9 MB JVM jar and needs prettier 1.x, python's has
// one 2018 release pinned to a prettier git SHA, no prettier plugin formats Go source at all, and no
// viable prettier plugin formats Rust source either). Pins the shell/java/php CLI-chain removal.
test("REGISTRY holds exactly go, kotlin, python, rust", () => {
  assert.deepEqual(Object.keys(REGISTRY).sort(), ["go", "kotlin", "python", "rust"]);
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
