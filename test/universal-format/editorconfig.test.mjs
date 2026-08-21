import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEditorconfig, matchGlob, resolveEditorconfig, buildInvocation, REGISTRY } from "../../plugins/universal-format/mcp/server.mjs";

// The artifact is a @ts-nocheck generated bundle, so TS infers resolveEditorconfig's `props` from
// the emitted JS as a union that still includes the empty-object start state — a direct
// `r.props.indent_size` read is a TS2339 in this checked test file. Same cast idiom as
// prettier.test.mjs uses for the handler results.
/** @param {{props: unknown}} r @returns {any} */
const props = (r) => r.props;

test("matchGlob supports *, *.ext, *.{a,b}, **.ext; rejects unsupported forms", () => {
  assert.equal(matchGlob("*", "Foo.java"), true);
  assert.equal(matchGlob("*.java", "Foo.java"), true);
  assert.equal(matchGlob("*.java", "Foo.kt"), false);
  assert.equal(matchGlob("*.{js,ts}", "a.ts"), true);
  assert.equal(matchGlob("*.{js,ts}", "a.go"), false);
  assert.equal(matchGlob("**.java", "Foo.java"), true);
  assert.equal(matchGlob("src/*.java", "Foo.java"), false); // path separator -> unsupported
  assert.equal(matchGlob("[abc].js", "a.js"), false); // charset -> unsupported
});

test("parseEditorconfig reads root flag and sections in order", () => {
  const pf = parseEditorconfig("root = true\n\n[*.java]\nindent_size = 4\n# comment\n[*]\nindent_style = space\n");
  assert.equal(pf.root, true);
  assert.equal(pf.sections.length, 2);
  assert.deepEqual(pf.sections[0], {
    glob: "*.java",
    props: { indent_size: "4" },
  });
  assert.deepEqual(pf.sections[1], {
    glob: "*",
    props: { indent_style: "space" },
  });
});

test("resolveEditorconfig: later matching section wins within a file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-ec-"));
  writeFileSync(path.join(dir, ".editorconfig"), "root = true\n[*]\nindent_size = 2\n[*.java]\nindent_size = 4\n");
  const r = resolveEditorconfig(path.join(dir, "Foo.java"), dir);
  assert.equal(r.found, true);
  assert.equal(props(r).indent_size, 4);
});

test("resolveEditorconfig: nearer file overrides farther; stops climbing at root=true", () => {
  const root = mkdtempSync(path.join(tmpdir(), "uf-ec-"));
  writeFileSync(path.join(root, ".editorconfig"), "root = true\n[*]\nindent_size = 2\nmax_line_length = 120\n");
  const sub = path.join(root, "sub");
  mkdirSync(sub);
  writeFileSync(path.join(sub, ".editorconfig"), "[*]\nindent_size = 8\n");
  const r = resolveEditorconfig(path.join(sub, "a.py"), root);
  assert.equal(props(r).indent_size, 8); // nearer file wins
  assert.equal(props(r).max_line_length, 120); // inherited from the root file
});

test("resolveEditorconfig: nothing found -> {found:false}", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-ec-"));
  const r = resolveEditorconfig(path.join(dir, "a.py"), dir);
  assert.equal(r.found, false);
  assert.deepEqual(r.props, {});
});

test("resolveEditorconfig: indent_style=tab surfaces for hard-conflict predicates", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uf-ec-"));
  writeFileSync(path.join(dir, ".editorconfig"), "root = true\n[*]\nindent_style = tab\n");
  const r = resolveEditorconfig(path.join(dir, "Foo.java"), dir);
  assert.equal(props(r).indent_style, "tab");
});

const rustfmt = REGISTRY.rust.chain[0];

test("rustfmt: max_line_length maps to --config max_width", () => {
  assert.deepEqual(buildInvocation(rustfmt, { editorconfig: { max_line_length: 120 } }), { argv: ["--config", "max_width=120"] });
});

test("rustfmt: indent_style tab/space maps to --config hard_tabs", () => {
  assert.deepEqual(buildInvocation(rustfmt, { editorconfig: { indent_style: "tab" } }), { argv: ["--config", "hard_tabs=true"] });
  assert.deepEqual(buildInvocation(rustfmt, { editorconfig: { indent_style: "space" } }), { argv: ["--config", "hard_tabs=false"] });
});

test("rustfmt: indent_size maps to --config tab_spaces", () => {
  assert.deepEqual(buildInvocation(rustfmt, { editorconfig: { indent_size: 4 } }), { argv: ["--config", "tab_spaces=4"] });
});

test("rustfmt: all three props combine in max_width/hard_tabs/tab_spaces order", () => {
  assert.deepEqual(
    buildInvocation(rustfmt, {
      editorconfig: {
        max_line_length: 100,
        indent_style: "space",
        indent_size: 4,
      },
    }),
    {
      argv: ["--config", "max_width=100", "--config", "hard_tabs=false", "--config", "tab_spaces=4"],
    },
  );
});

test("rustfmt: native config governs -> bare base (mapping bypassed)", () => {
  assert.deepEqual(
    buildInvocation(rustfmt, {
      hasNativeConfig: true,
      editorconfig: { max_line_length: 100 },
    }),
    { argv: [] },
  );
});

test("rustfmt: no editorconfig -> bare base", () => {
  assert.deepEqual(buildInvocation(rustfmt), { argv: [] });
});
