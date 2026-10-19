import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatInProcess, applyEdit, formatPre, resolveConfigPlugins, shrinkSwap } from "../../plugins/universal-format/mcp/server.mjs";

// No `maybe`/tier gating any more: prettier is bundled into the artifact, so every test here is
// unconditional. There is exactly one prettier instance in this process.

/** @param {string} prefix @returns {string} */
function tmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

// A minimal, deliberately NO-OP prettier plugin package inside the project's own node_modules:
// enough for require.resolve to find it and for prettier to import it, contributing no
// languages/parsers/printers. The point of the fixture is resolution (what resolveConfigPlugins
// fixes), not a visible formatting change.
/** @param {string} cwd @returns {string} */
function installNoopPrettierPlugin(cwd) {
  const dir = path.join(cwd, "node_modules", "uf-test-plugin");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "uf-test-plugin", version: "1.0.0", main: "index.js" }));
  writeFileSync(path.join(dir, "index.js"), "module.exports = {};\n");
  return path.join(dir, "index.js");
}

// Build a full ToolHookInput from just the fields these tests vary (repo mockInput idiom).
/** @param {{cwd:string, tool_name:string, tool_input:Record<string,unknown>}} p @returns {ToolHookInput} */
function hookInput(p) {
  return {
    session_id: "test-session",
    transcript_path: "/dev/null",
    cwd: p.cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: p.tool_name,
    tool_input: p.tool_input,
  };
}

/** @param {any} res @returns {string} */
const preContent = (res) => res.hookSpecificOutput.updatedInput.content;

test("formatInProcess formats js/json/markdown with the bundled prettier", async () => {
  const cwd = tmp("uf-fmt-");
  assert.equal(await formatInProcess("let x=1", path.join(cwd, "a.js"), cwd, "jsts"), "let x = 1;\n");
  assert.equal(await formatInProcess('{"a":1}', path.join(cwd, "a.json"), cwd, "json"), '{ "a": 1 }\n');
  assert.equal(await formatInProcess("#  Title\n", path.join(cwd, "a.md"), cwd, "markdown"), "# Title\n");
});

test("json printWidth override: no config -> unbounded (long array not wrapped)", async () => {
  const cwd = tmp("uf-pw-");
  const long = JSON.stringify([...Array(40).keys()]);
  const out = await formatInProcess(long, path.join(cwd, "a.json"), cwd, "json");
  assert.equal(out.split("\n").length, 2, "no-config json should stay on one line");
});

test("json printWidth override: .prettierrc printWidth honored", async () => {
  const cwd = tmp("uf-pw2-");
  writeFileSync(path.join(cwd, ".prettierrc"), JSON.stringify({ printWidth: 20 }));
  const long = JSON.stringify([...Array(40).keys()]);
  const out = await formatInProcess(long, path.join(cwd, "a.json"), cwd, "json");
  assert.ok(out.split("\n").length > 2, "a project printWidth must be honored (array wraps)");
});

// Config invalidation is event-driven: formatInProcess does not clear prettier's config cache per
// call (that cost ~9.9 of ~10.6 ms per format). The hook fires BEFORE a Write lands, so a Write of a
// config file leaves a pending refresh behind, and the first later format that finds the file
// changed on disk clears the cache -- never earlier, or the pre-write content would be re-cached.
// Both cases probe `semi` on a .mjs file deliberately: it is a value only prettier's own (cached)
// config can produce. A json/yaml printWidth probe would be confounded by shouldOverridePrintWidth,
// which re-reads the filesystem on every call and would react to a new .prettierrc even with the
// cache untouched.
test("config cache: a .prettierrc written through the hook takes effect once the write has landed, not before", async () => {
  const cwd = tmp("uf-cache-a-");
  const fp = path.join(cwd, "a.mjs");
  const before = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: "const a = 1\n" } })));
  assert.ok(preContent(before).includes(";"), "no config yet -> prettier's default semi: true");

  const rc = path.join(cwd, ".prettierrc");
  const rcContent = JSON.stringify({ semi: false });
  const onConfigWrite = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: rc, content: rcContent } }));
  assert.deepEqual(onConfigWrite, {}, "the hook on the config Write itself formats nothing (no extension)");

  const notLanded = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: "const a = 1\n" } })));
  assert.ok(preContent(notLanded).includes(";"), "while the Write has not landed, the cached (absent) config stays in force");

  writeFileSync(rc, rcContent); // the Write tool lands it
  const after = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: "const a = 1;\n" } })));
  assert.ok(!preContent(after).includes(";"), "the first format after the write landed must see the new .prettierrc");
});

// An Edit of an existing config file lands too: the pending refresh keys on the file's on-disk stamp
// (inode, size, mtime), so the edited content is picked up exactly like a fresh Write's.
test("config cache: an Edit of an existing .prettierrc is picked up once it has landed", async () => {
  const cwd = tmp("uf-cache-edit-");
  const fp = path.join(cwd, "a.mjs");
  const rc = path.join(cwd, ".prettierrc");
  writeFileSync(rc, JSON.stringify({ semi: false }));
  const before = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: "const a = 1;\n" } })));
  assert.ok(!preContent(before).includes(";"), "semi: false in force");

  assert.deepEqual(await formatPre(hookInput({ cwd, tool_name: "Edit", tool_input: { file_path: rc, old_string: "false", new_string: "true" } })), {});
  await new Promise((r) => setTimeout(r, 5)); // keep the mtime distinguishable on coarse filesystems
  writeFileSync(rc, JSON.stringify({ semi: true })); // the Edit tool lands it
  const after = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: "const a = 1\n" } })));
  assert.ok(preContent(after).includes(";"), "the edited .prettierrc must take effect once it landed");
});

// The documented trade-off of dropping the per-format clear: a config that appears without ever
// passing through Write/Edit (a Bash `sed`, an external editor) is NOT picked up. Prettier caches
// the negative lookup too, so this holds for a newly created config, not only for an edited one.
test("config cache: a .prettierrc appearing out of band is NOT picked up (documented trade-off)", async () => {
  const cwd = tmp("uf-cache-b-");
  const fp = path.join(cwd, "a.mjs");
  await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: "const a = 1\n" } })); // primes the cache
  writeFileSync(path.join(cwd, ".prettierrc"), JSON.stringify({ semi: false })); // no hook fires
  const after = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: "const a = 1\n" } })));
  assert.ok(preContent(after).includes(";"), "still formatted with the pre-write config");
});

test("applyEdit: replace_all, single swap, null on absent and non-unique", () => {
  assert.equal(applyEdit("a a a", "a", "b", true), "b b b");
  assert.equal(applyEdit("xAy", "A", "Z", false), "xZy");
  assert.equal(applyEdit("no match", "Q", "Z", false), null);
  assert.equal(applyEdit("a a", "a", "b", false), null); // non-unique
  assert.equal(applyEdit("nope", "Q", "Z", true), null); // replace_all, absent
});

// An empty old_string "matches" under both includes() and indexOf(), so without an explicit guard
// the replace_all branch would splice new_string between every character of the file and hand
// that whole-file swap back as updatedInput.
test("applyEdit: empty old_string is rejected on both branches", () => {
  assert.equal(applyEdit("abc", "", "X", false), null);
  assert.equal(applyEdit("abc", "", "X", true), null);
});

// Every swap must satisfy the Edit tool's contract (old_string present exactly once, non-empty,
// different from new_string) and reproduce the formatted file when applied -- checked through
// applyEdit, the in-process mirror of that contract.
/** @param {string} current @param {string} formatted @returns {{old_string: string, new_string: string}} */
function swapOf(current, formatted) {
  const swap = /** @type {{old_string: string, new_string: string}} */ (shrinkSwap(current, formatted));
  assert.ok(swap, "a differing pair must yield a swap");
  assert.notEqual(swap.old_string, "", "old_string must be non-empty");
  assert.notEqual(swap.old_string, swap.new_string, "old_string must differ from new_string");
  assert.equal(applyEdit(current, swap.old_string, swap.new_string, false), formatted, "applying the swap must yield the formatted file");
  return swap;
}

test("shrinkSwap: swaps only the changed whole lines (single line, multi-line, deletion, unterminated last line)", () => {
  assert.deepEqual(swapOf("a\nb\nc\n", "a\nB\nc\n"), { old_string: "b\n", new_string: "B\n" });
  assert.deepEqual(swapOf("a\nb\nc\nd\n", "a\nX\nY\nd\n"), { old_string: "b\nc\n", new_string: "X\nY\n" });
  assert.deepEqual(swapOf("a\nb\nc\n", "a\nc\n"), { old_string: "b\n", new_string: "" });
  assert.deepEqual(swapOf("a\nb", "a\nB"), { old_string: "b", new_string: "B" });
  assert.deepEqual(swapOf("ab\ncd\n", "aXb\ncd\n"), { old_string: "ab\n", new_string: "aXb\n" });
});

test("shrinkSwap: pure insertions take a neighbouring line (between lines, at EOF, at BOF)", () => {
  assert.deepEqual(swapOf("a\nb\n", "a\nX\nb\n"), { old_string: "b\n", new_string: "X\nb\n" });
  assert.deepEqual(swapOf("a\nb\n", "a\nb\nc\n"), { old_string: "b\n", new_string: "b\nc\n" });
  assert.deepEqual(swapOf("a\n", "X\na\n"), { old_string: "a\n", new_string: "X\na\n" });
});

test("shrinkSwap: a non-unique run widens line by line until unique, up to the whole file", () => {
  assert.deepEqual(swapOf("x\nb\nx\nb\n", "x\nb\nx\nB\n"), { old_string: "b\nx\nb\n", new_string: "b\nx\nB\n" });
  assert.deepEqual(swapOf("\na\n", "X\na\n"), { old_string: "\na\n", new_string: "X\na\n" });
  // every line differs -> the swap IS the whole file, exactly what the old whole-file swap sent
  assert.deepEqual(swapOf("a\nb\n", "A\nB\n"), { old_string: "a\nb\n", new_string: "A\nB\n" });
});

test("shrinkSwap: identical texts yield null; a long file costs only the changed line", () => {
  assert.equal(shrinkSwap("same\n", "same\n"), null);
  const lines = Array.from({ length: 2000 }, (_, i) => `const v${i} = ${i};`);
  const current = lines.join("\n") + "\n";
  const formatted = current.replace("const v1234 = 1234;", "const v1234 = 4321;");
  assert.deepEqual(swapOf(current, formatted), { old_string: "const v1234 = 1234;\n", new_string: "const v1234 = 4321;\n" });
});

test("format_pre Write: updatedInput.content formatted, no permissionDecision", async () => {
  const cwd = tmp("uf-pre-w-");
  const res = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "a.json"), content: '{"a":1}' } })));
  assert.equal(res.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(res.hookSpecificOutput.updatedInput.content, '{ "a": 1 }\n');
  assert.equal(res.hookSpecificOutput.updatedInput.file_path, path.join(cwd, "a.json"));
  assert.ok(!("permissionDecision" in res.hookSpecificOutput), "format_pre must never set permissionDecision");
  assert.ok(typeof res.hookSpecificOutput.additionalContext === "string");
});

// `.prettierignore` is the ONLY ignore source. Deliberate divergence from `prettier --write`,
// whose CLI filters even an explicitly named file through --ignore-path (default
// [.gitignore, .prettierignore]): here a .gitignore'd file IS formatted unless .prettierignore
// lists it too. Do not "restore parity" by re-adding .gitignore -- both directions are pinned
// below. getFileInfo does not auto-discover ignore files, so the one path is passed explicitly.
test("format_pre: a .prettierignore'd file is left alone", async () => {
  const cwd = tmp("uf-ign-a-");
  writeFileSync(path.join(cwd, ".prettierignore"), "ignored.json\n");
  const plain = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "kept.json"), content: '{"a":1}' } })));
  assert.ok(plain.hookSpecificOutput, "a non-ignored file is still formatted");
  const res = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "ignored.json"), content: '{"a":1}' } }));
  assert.deepEqual(res, {});
});

test("format_pre: a .gitignore'd file is still formatted (.prettierignore is the only ignore source)", async () => {
  const cwd = tmp("uf-ign-b-");
  writeFileSync(path.join(cwd, ".gitignore"), "generated.json\n");
  const res = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "generated.json"), content: '{"a":1}' } })));
  assert.equal(preContent(res), '{ "a": 1 }\n', "a .gitignore must not suppress formatting any more");
});

// The whole MERGED file is formatted (a fragment cannot be), but the swap handed to the Edit tool
// covers only the lines that actually change -- applied, it still yields the fully formatted file.
test("format_pre Edit: swaps only the changed lines of the formatted file, replace_all false", async () => {
  const cwd = tmp("uf-pre-e-");
  const fp = path.join(cwd, "a.json");
  const current = '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n';
  writeFileSync(fp, current);
  const res = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Edit", tool_input: { file_path: fp, old_string: '"b": 2', new_string: '"b":   22' } })));
  const { old_string, new_string, replace_all } = res.hookSpecificOutput.updatedInput;
  assert.equal(old_string, '  "b": 2,\n');
  assert.equal(new_string, '  "b": 22,\n');
  assert.equal(replace_all, false);
  assert.equal(applyEdit(current, old_string, new_string, false), '{\n  "a": 1,\n  "b": 22,\n  "c": 3\n}\n');
  assert.ok(!("permissionDecision" in res.hookSpecificOutput));
});

test("format_pre Edit: a one-line file still swaps whole (the run IS the file)", async () => {
  const cwd = tmp("uf-pre-e1-");
  const fp = path.join(cwd, "a.json");
  writeFileSync(fp, '{ "a": 1 }\n');
  const res = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Edit", tool_input: { file_path: fp, old_string: '"a": 1', new_string: '"a":2' } })));
  assert.equal(res.hookSpecificOutput.updatedInput.old_string, '{ "a": 1 }\n');
  assert.equal(res.hookSpecificOutput.updatedInput.new_string, '{ "a": 2 }\n');
});

// The Edit tool matches old_string against LF-normalized content and writes CRLF back to a CRLF
// file itself, so the swap must never carry a CR (it could not match) and a multi-line old_string
// typed as the model saw the file (LF) must still reach the formatter. A project that configures
// `endOfLine: "crlf"` must not turn an already-formatted edit into a whole-file swap either.
test("format_pre Edit: a CRLF file is swapped in LF space, never with a CR", async () => {
  const cwd = tmp("uf-pre-crlf-");
  const fp = path.join(cwd, "a.json");
  writeFileSync(fp, '{\r\n  "a": 1,\r\n  "b": 2,\r\n  "c": 3\r\n}\r\n');
  for (const [old_string, new_string] of [
    ['"b": 2', '"b":   22'],
    ['"b": 2,\n  "c": 3', '"b":   22,\n  "c": 3'],
  ]) {
    const res = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Edit", tool_input: { file_path: fp, old_string, new_string } })));
    const swap = res.hookSpecificOutput.updatedInput;
    assert.ok(!swap.old_string.includes("\r") && !swap.new_string.includes("\r"), "no CR may reach the Edit tool");
    assert.equal(applyEdit('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n', swap.old_string, swap.new_string, false), '{\n  "a": 1,\n  "b": 22,\n  "c": 3\n}\n');
  }
  const clean = { file_path: fp, old_string: '"b": 2', new_string: '"b": 7' };
  assert.deepEqual(await formatPre(hookInput({ cwd, tool_name: "Edit", tool_input: clean })), {}, "an already-formatted edit stays a plain Edit");
  const crlfCwd = tmp("uf-pre-crlf-cfg-");
  const crlfFp = path.join(crlfCwd, "a.json");
  writeFileSync(path.join(crlfCwd, ".prettierrc"), '{ "endOfLine": "crlf" }\n');
  writeFileSync(crlfFp, '{\r\n  "a": 1,\r\n  "b": 2\r\n}\r\n');
  assert.deepEqual(await formatPre(hookInput({ cwd: crlfCwd, tool_name: "Edit", tool_input: { ...clean, file_path: crlfFp } })), {}, "endOfLine crlf: an already-formatted edit stays a plain Edit");
});

// An edit prettier formats straight back to the pre-edit file has no effect once formatted, so the
// handler turns it into a no-op Edit (old_string == new_string) with a notice: the file stays
// formatted instead of the raw, format-only edit landing and waiting for the next write.
test("format_pre Edit: an edit prettier formats straight back becomes a no-op swap with a notice", async () => {
  const cwd = tmp("uf-pre-e3-");
  const fp = path.join(cwd, "a.json");
  writeFileSync(fp, '{ "a": 1 }\n');
  const res = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Edit", tool_input: { file_path: fp, old_string: '"a": 1', new_string: '"a":1' } })));
  assert.deepEqual(res.hookSpecificOutput.updatedInput, { file_path: fp, old_string: '"a": 1', new_string: '"a": 1', replace_all: false });
  assert.match(res.hookSpecificOutput.additionalContext, /nothing to change/);
  assert.ok(!("permissionDecision" in res.hookSpecificOutput));
});

test("format_pre Edit: absent old_string -> {}", async () => {
  const cwd = tmp("uf-pre-e2-");
  const fp = path.join(cwd, "a.json");
  writeFileSync(fp, '{ "a": 1 }\n');
  const res = await formatPre(hookInput({ cwd, tool_name: "Edit", tool_input: { file_path: fp, old_string: "NOT PRESENT", new_string: "x" } }));
  assert.deepEqual(res, {});
});

test("format_pre: CLI language with no formatter on PATH, and an excluded path -> {}", async () => {
  const cwd = tmp("uf-guard-");
  // An empty PATH: whatever onPath() may already have cached for a Go formatter, the spawn itself
  // cannot find one, and a spawn error fails open like a missing tool does.
  const originalPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const go = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "a.go"), content: "package main" } }));
    assert.deepEqual(go, {});
  } finally {
    process.env.PATH = originalPath;
  }
  mkdirSync(path.join(cwd, "node_modules", "pkg"), { recursive: true });
  const nm = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "node_modules", "pkg", "a.json"), content: '{"a":1}' } }));
  assert.deepEqual(nm, {});
});

// A bundled prettier resolves a config's `plugins:` specifiers against the SERVER process's cwd,
// not the session's: from a foreign cwd format() throws `Cannot find package '<pp>' imported from
// <procCwd>/noop.js`, which the handler's catch would turn into a silent "no formatting at all".
test("resolveConfigPlugins: bare specifiers resolve against cwd; absolute paths and non-strings pass through", () => {
  const cwd = tmp("uf-pp-");
  const entry = installNoopPrettierPlugin(cwd);
  const out = resolveConfigPlugins(["uf-test-plugin", "/already/absolute.mjs", { inline: true }], cwd);
  assert.deepEqual(out, [entry, "/already/absolute.mjs", { inline: true }]);
});

test("resolveConfigPlugins: an unresolvable entry yields null (never format without the plugin)", () => {
  const cwd = tmp("uf-pp-bad-");
  assert.equal(resolveConfigPlugins(["definitely-not-installed-plugin"], cwd), null);
});

test("format_pre: a .prettierrc naming a resolvable local plugin still formats the file", async () => {
  const cwd = tmp("uf-pp-ok-");
  installNoopPrettierPlugin(cwd);
  writeFileSync(path.join(cwd, ".prettierrc"), JSON.stringify({ plugins: ["uf-test-plugin"] }));
  const res = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "a.json"), content: '{"a":1}' } })));
  assert.equal(preContent(res), '{ "a": 1 }\n');
});

test("format_pre: a .prettierrc naming an unresolvable plugin yields {} rather than plugin-less output", async () => {
  const cwd = tmp("uf-pp-bad2-");
  writeFileSync(path.join(cwd, ".prettierrc"), JSON.stringify({ plugins: ["definitely-not-installed-plugin"] }));
  const res = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "a.json"), content: '{"a":1}' } }));
  assert.deepEqual(res, {});
});

// `contains` (inside resolveBase) is path.relative-based on purpose. The older
// `resolved.startsWith(cwd + path.sep)` form rejected EVERY file when cwd carried a trailing
// separator (or was "/"), i.e. it silently disabled the whole plugin for that session. There is
// no outside-cwd GATE any more: a sibling directory is anchored at its own project instead.
test("format_pre anchoring: trailing-separator cwd still formats; a file outside cwd is formatted against its own directory", async () => {
  const cwd = tmp("uf-guard-cwd-");
  const inside = /** @type {any} */ (await formatPre(hookInput({ cwd: cwd + path.sep, tool_name: "Write", tool_input: { file_path: path.join(cwd, "a.json"), content: '{"a":1}' } })));
  assert.equal(preContent(inside), '{ "a": 1 }\n', "a trailing-separator cwd must not disable the plugin");

  const outsideDir = path.join(path.dirname(cwd), path.basename(cwd) + "-other");
  mkdirSync(outsideDir, { recursive: true });
  const outside = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(outsideDir, "a.json"), content: '{"a":1}' } })));
  assert.equal(preContent(outside), '{ "a": 1 }\n', "a sibling directory is anchored at itself, not skipped");
});

// hasRules is derived from file CONTENT, not mere existence: a base with no .prettierignore at
// all, and one whose .prettierignore holds only blank/# lines, both provably cannot ignore
// anything, so the ignore round-trip is skipped entirely. Regression anchor for that fast path --
// the fixture is a .prettierignore on purpose, since a .gitignore is no longer read at all and
// would make this test pass for the wrong reason.
test("ignore fast path: no ignore file, and a comments-only .prettierignore, both still format", async () => {
  const empty = tmp("uf-ign-none-");
  const bare = /** @type {any} */ (await formatPre(hookInput({ cwd: empty, tool_name: "Write", tool_input: { file_path: path.join(empty, "a.json"), content: '{"a":1}' } })));
  assert.equal(preContent(bare), '{ "a": 1 }\n');

  const commented = tmp("uf-ign-hash-");
  writeFileSync(path.join(commented, ".prettierignore"), "# nothing here\n\n   \n");
  const res = /** @type {any} */ (await formatPre(hookInput({ cwd: commented, tool_name: "Write", tool_input: { file_path: path.join(commented, "a.json"), content: '{"a":1}' } })));
  assert.equal(preContent(res), '{ "a": 1 }\n');
});

// The verdict memo must not change any answer: gitignore matching is purely path-based, so a
// second call for the same path in the same cwd is the cached boolean, and an unseen sibling
// still goes through prettier.
test("ignore verdict memo: a repeated ignored path stays ignored, an unseen sibling still formats", async () => {
  const cwd = tmp("uf-ign-memo-");
  writeFileSync(path.join(cwd, ".prettierignore"), "ignored.json\n");
  const fp = path.join(cwd, "ignored.json");
  assert.deepEqual(await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } })), {});
  assert.deepEqual(await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } })), {});
  const sibling = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "kept.json"), content: '{"a":1}' } })));
  assert.equal(preContent(sibling), '{ "a": 1 }\n');
});

// The documented trade-off of caching the ignore state, mirroring the .prettierrc one above: an
// ignore file that appears without ever passing through Write/Edit (a Bash `sed`, an external
// editor) is NOT picked up until a hook refreshes it or the server restarts. Fail direction is
// mild — a newly ignored file gets formatted once more.
test("ignore cache: a .prettierignore appearing out of band is NOT picked up (documented trade-off)", async () => {
  const cwd = tmp("uf-ign-oob-");
  const fp = path.join(cwd, "late.json");
  await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } })); // primes the cache
  writeFileSync(path.join(cwd, ".prettierignore"), "late.json\n"); // no hook fires
  const after = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } })));
  assert.equal(preContent(after), '{ "a": 1 }\n', "still formatted with the pre-write ignore state");
});

// The update path, mirroring the .prettierrc one above: an ignore file written THROUGH the hook
// re-reads that base's ignore state (and discards its memoized verdicts) once the write has landed
// -- the only correct moment, since at PreToolUse the write has not happened yet.
test("ignore cache: a .prettierignore written through the hook takes effect once the write has landed", async () => {
  const cwd = tmp("uf-ign-post-");
  const fp = path.join(cwd, "late.json");
  const before = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } })));
  assert.equal(preContent(before), '{ "a": 1 }\n', "no ignore file yet -> formatted");

  const ign = path.join(cwd, ".prettierignore");
  assert.deepEqual(await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: ign, content: "late.json\n" } })), {});
  const notLanded = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } })));
  assert.equal(preContent(notLanded), '{ "a": 1 }\n', "still formatted while the ignore file is not on disk");

  writeFileSync(ign, "late.json\n"); // the Write tool lands it
  const after = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } }));
  assert.deepEqual(after, {}, "the landed .prettierignore must be re-read before the next format");
});

// cwd is a HINT, not a gate: a file written outside the session cwd is formatted against its OWN
// project. Its git root's .prettierignore governs it; the session cwd's does not reach into it.
// This is the correctness claim of the whole anchoring design, asserted in both directions.
test("out-of-cwd anchoring: the file's own git root governs, not the session cwd", async () => {
  const cwd = tmp("uf-anchor-cwd-");
  writeFileSync(path.join(cwd, ".prettierignore"), "foreign.json\n");
  const proj = tmp("uf-anchor-proj-");
  mkdirSync(path.join(proj, ".git"));
  writeFileSync(path.join(proj, ".prettierignore"), "blocked.json\n");
  mkdirSync(path.join(proj, "src"));

  const foreign = /** @type {any} */ (
    await formatPre({
      ...hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(proj, "src", "foreign.json"), content: '{"a":1}' } }),
      session_id: "uf-anchor-session-1",
    })
  );
  assert.equal(preContent(foreign), '{ "a": 1 }\n', "the session cwd's ignore rules must not reach into another project");

  const blocked = await formatPre({
    ...hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(proj, "src", "blocked.json"), content: '{"a":1}' } }),
    session_id: "uf-anchor-session-2",
  });
  assert.deepEqual(blocked, {}, "the file's own project's .prettierignore must govern it");
});

// A linked worktree's and a submodule's .git is a FILE, so resolveBase existence-checks .git
// rather than stat'ing it as a directory. Without that, a worktree would fall through to branch 3.
test("out-of-cwd anchoring: a .git FILE (worktree/submodule shape) is a project root too", async () => {
  const cwd = tmp("uf-anchor-cwd2-");
  const proj = tmp("uf-anchor-wt-");
  writeFileSync(path.join(proj, ".git"), "gitdir: /elsewhere/.git/worktrees/wt\n");
  writeFileSync(path.join(proj, ".prettierignore"), "blocked.json\n");
  mkdirSync(path.join(proj, "src"));

  const blocked = await formatPre({
    ...hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(proj, "src", "blocked.json"), content: '{"a":1}' } }),
    session_id: "uf-anchor-session-3",
  });
  assert.deepEqual(blocked, {}, "the worktree root's own .prettierignore must govern its files");

  const kept = /** @type {any} */ (
    await formatPre({
      ...hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(proj, "src", "kept.json"), content: '{"a":1}' } }),
      session_id: "uf-anchor-session-4",
    })
  );
  assert.equal(preContent(kept), '{ "a": 1 }\n', "a non-ignored file in that worktree is still formatted");
});

// No residual project-membership gate: a file belonging to no project at all is formatted,
// anchored at its own directory -- and a .prettierignore sitting right next to it is still a
// working opt-out, which is why no plugin-side toggle is needed. Plus the one unresolvable case:
// a relative file_path with no cwd to resolve it against.
test("out-of-cwd anchoring: an orphan file formats, its own directory's .prettierignore still opts out", async () => {
  const cwd = tmp("uf-orphan-cwd-");
  const orphan = tmp("uf-orphan-");
  const kept = /** @type {any} */ (
    await formatPre({
      ...hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(orphan, "a.json"), content: '{"a":1}' } }),
      session_id: "uf-orphan-session-1",
    })
  );
  assert.equal(preContent(kept), '{ "a": 1 }\n', "no project-membership gate: an orphan file is still formatted");

  const opted = tmp("uf-orphan-opt-");
  writeFileSync(path.join(opted, ".prettierignore"), "a.json\n");
  const res = await formatPre({
    ...hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(opted, "a.json"), content: '{"a":1}' } }),
    session_id: "uf-orphan-session-2",
  });
  assert.deepEqual(res, {}, "a .prettierignore in the file's own directory is still an opt-out");

  const noCwdAbsolute = /** @type {any} */ (
    await formatPre({
      ...hookInput({ cwd: "", tool_name: "Write", tool_input: { file_path: path.join(orphan, "b.json"), content: '{"a":1}' } }),
      session_id: "uf-orphan-session-3",
    })
  );
  assert.equal(preContent(noCwdAbsolute), '{ "a": 1 }\n', "no cwd at all + an absolute path is still resolvable");

  const noCwdRelative = await formatPre({
    ...hookInput({ cwd: "", tool_name: "Write", tool_input: { file_path: "b.json", content: '{"a":1}' } }),
    session_id: "uf-orphan-session-4",
  });
  assert.deepEqual(noCwdRelative, {}, "a relative path with no cwd has nothing to resolve against");
});

// Out-of-cwd absolute write into a SIBLING agent's worktree (the session's own cwd is elsewhere):
// resolveBase's git-root walk lands directly on the worktree root (its `.git` is a FILE), which
// would erase `.claude/worktrees` from a base-relative `rel`. isClaudeInternalPath's absolute-path
// check (gated on base !== cwd) must still exclude it -- this agent never entered that worktree, so
// it must not reformat another agent's in-flight scratch state.
test("out-of-cwd absolute write into a sibling agent's worktree is still excluded", async () => {
  const cwd = tmp("uf-sibling-cwd-");
  const siblingRepo = tmp("uf-sibling-repo-");
  const siblingWorktree = path.join(siblingRepo, ".claude", "worktrees", "other-agent-wt");
  mkdirSync(siblingWorktree, { recursive: true });
  writeFileSync(path.join(siblingWorktree, ".git"), "gitdir: /elsewhere/.git/worktrees/other-agent-wt\n");
  const fp = path.join(siblingWorktree, "a.json");

  const result = /** @type {any} */ (await formatPre({ ...hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } }), session_id: "uf-sibling-worktree-session" }));
  assert.deepEqual(result, {}, "a sibling agent's worktree must stay excluded even though resolveBase anchors base at its own root");
});
