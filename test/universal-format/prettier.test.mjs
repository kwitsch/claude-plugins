import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatInProcess, applyEdit, formatPre, formatPost, resolveConfigPlugins } from "../../plugins/universal-format/mcp/server.mjs";

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
// call (that cost ~9.9 of ~10.6 ms per format). formatPost clears it when a config/ignore file is
// written — which is why the .prettierrc write below is followed by a formatPost on that file,
// exactly as the two hooks fire in a real session. Both cases probe `semi` on a .mjs file
// deliberately: it is a value only prettier's own (cached) config can produce. A json/yaml
// printWidth probe would be confounded by shouldOverridePrintWidth, which re-reads the
// filesystem on every call and would react to a new .prettierrc even with the cache untouched.
test("config cache: a .prettierrc written through the hooks takes effect on the next format", async () => {
  const cwd = tmp("uf-cache-a-");
  const fp = path.join(cwd, "a.mjs");
  const before = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: "const a = 1\n" } })));
  assert.ok(preContent(before).includes(";"), "no config yet -> prettier's default semi: true");

  const rc = path.join(cwd, ".prettierrc");
  writeFileSync(rc, JSON.stringify({ semi: false }));
  await formatPost(/** @type {any} */ (hookInput({ cwd, tool_name: "Write", tool_input: { file_path: rc } })));

  const after = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: "const a = 1;\n" } })));
  assert.ok(!preContent(after).includes(";"), "the new .prettierrc must take effect once formatPost invalidated the cache");
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

test("format_pre Write: updatedInput.content formatted, no permissionDecision", async () => {
  const cwd = tmp("uf-pre-w-");
  const res = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "a.json"), content: '{"a":1}' } })));
  assert.equal(res.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(res.hookSpecificOutput.updatedInput.content, '{ "a": 1 }\n');
  assert.equal(res.hookSpecificOutput.updatedInput.file_path, path.join(cwd, "a.json"));
  assert.ok(!("permissionDecision" in res.hookSpecificOutput), "format_pre must never set permissionDecision");
  assert.ok(typeof res.hookSpecificOutput.additionalContext === "string");
});

// isPrettierIgnored is now the ONLY thing keeping the in-process path at parity with
// `prettier --write <file>`, which filters even an explicitly named file through --ignore-path
// ([.gitignore, .prettierignore]). getFileInfo does not auto-discover those.
test("format_pre: a .prettierignore'd file is left alone", async () => {
  const cwd = tmp("uf-ign-a-");
  writeFileSync(path.join(cwd, ".prettierignore"), "ignored.json\n");
  const plain = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "kept.json"), content: '{"a":1}' } })));
  assert.ok(plain.hookSpecificOutput, "a non-ignored file is still formatted");
  const res = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "ignored.json"), content: '{"a":1}' } }));
  assert.deepEqual(res, {});
});

test("format_pre: a .gitignore'd file is left alone", async () => {
  const cwd = tmp("uf-ign-b-");
  writeFileSync(path.join(cwd, ".gitignore"), "generated.json\n");
  const res = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "generated.json"), content: '{"a":1}' } }));
  assert.deepEqual(res, {});
});

test("format_pre Edit: whole-file swap old_string=full pre-edit, new_string=formatted, replace_all false", async () => {
  const cwd = tmp("uf-pre-e-");
  const fp = path.join(cwd, "a.json");
  writeFileSync(fp, '{ "a": 1 }\n');
  const res = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Edit", tool_input: { file_path: fp, old_string: '"a": 1', new_string: '"a":2' } })));
  assert.equal(res.hookSpecificOutput.updatedInput.old_string, '{ "a": 1 }\n');
  assert.equal(res.hookSpecificOutput.updatedInput.new_string, '{ "a": 2 }\n');
  assert.equal(res.hookSpecificOutput.updatedInput.replace_all, false);
  assert.ok(!("permissionDecision" in res.hookSpecificOutput));
});

test("format_pre Edit: absent old_string -> {}", async () => {
  const cwd = tmp("uf-pre-e2-");
  const fp = path.join(cwd, "a.json");
  writeFileSync(fp, '{ "a": 1 }\n');
  const res = await formatPre(hookInput({ cwd, tool_name: "Edit", tool_input: { file_path: fp, old_string: "NOT PRESENT", new_string: "x" } }));
  assert.deepEqual(res, {});
});

test("format_pre: non-prettier ext (.go) and excluded path -> {}", async () => {
  const cwd = tmp("uf-guard-");
  const go = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "a.go"), content: "package main" } }));
  assert.deepEqual(go, {});
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
