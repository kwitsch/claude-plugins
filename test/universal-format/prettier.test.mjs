import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatInProcess, applyEdit, cwdChanged, formatPre, formatPost, resolveConfigPlugins, worktreeEntered } from "../../plugins/universal-format/mcp/server.mjs";

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

// Build a full CwdChangedHookInput from just the two directories these tests vary.
/** @param {{old_cwd:string, new_cwd:string}} p @returns {CwdChangedHookInput} */
function cwdChangedInput(p) {
  return {
    session_id: "test-session",
    transcript_path: "/dev/null",
    cwd: p.new_cwd,
    permission_mode: "default",
    hook_event_name: "CwdChanged",
    old_cwd: p.old_cwd,
    new_cwd: p.new_cwd,
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
  const res = /** @type {any} */ (
    await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "generated.json"), content: '{"a":1}' } }))
  );
  assert.equal(preContent(res), '{ "a": 1 }\n', "a .gitignore must not suppress formatting any more");
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

// `contains` (inside resolveBase) is path.relative-based on purpose. The older
// `resolved.startsWith(cwd + path.sep)` form rejected EVERY file when cwd carried a trailing
// separator (or was "/"), i.e. it silently disabled the whole plugin for that session. There is
// no outside-cwd GATE any more: a sibling directory is anchored at its own project instead.
test("format_pre anchoring: trailing-separator cwd still formats; a file outside cwd is formatted against its own directory", async () => {
  const cwd = tmp("uf-guard-cwd-");
  const inside = /** @type {any} */ (
    await formatPre(hookInput({ cwd: cwd + path.sep, tool_name: "Write", tool_input: { file_path: path.join(cwd, "a.json"), content: '{"a":1}' } }))
  );
  assert.equal(preContent(inside), '{ "a": 1 }\n', "a trailing-separator cwd must not disable the plugin");

  const outsideDir = path.join(path.dirname(cwd), path.basename(cwd) + "-other");
  mkdirSync(outsideDir, { recursive: true });
  const outside = /** @type {any} */ (
    await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(outsideDir, "a.json"), content: '{"a":1}' } }))
  );
  assert.equal(preContent(outside), '{ "a": 1 }\n', "a sibling directory is anchored at itself, not skipped");
});

// hasRules is derived from file CONTENT, not mere existence: a base with no .prettierignore at
// all, and one whose .prettierignore holds only blank/# lines, both provably cannot ignore
// anything, so the ignore round-trip is skipped entirely. Regression anchor for that fast path --
// the fixture is a .prettierignore on purpose, since a .gitignore is no longer read at all and
// would make this test pass for the wrong reason.
test("ignore fast path: no ignore file, and a comments-only .prettierignore, both still format", async () => {
  const empty = tmp("uf-ign-none-");
  const bare = /** @type {any} */ (
    await formatPre(hookInput({ cwd: empty, tool_name: "Write", tool_input: { file_path: path.join(empty, "a.json"), content: '{"a":1}' } }))
  );
  assert.equal(preContent(bare), '{ "a": 1 }\n');

  const commented = tmp("uf-ign-hash-");
  writeFileSync(path.join(commented, ".prettierignore"), "# nothing here\n\n   \n");
  const res = /** @type {any} */ (
    await formatPre(hookInput({ cwd: commented, tool_name: "Write", tool_input: { file_path: path.join(commented, "a.json"), content: '{"a":1}' } }))
  );
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
  const sibling = /** @type {any} */ (
    await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "kept.json"), content: '{"a":1}' } }))
  );
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

// The update path, mirroring the .prettierrc one above: an ignore file written THROUGH the hooks
// re-reads that cwd's ignore state (and discards its memoized verdicts) at PostToolUse — the only
// correct moment, since at PreToolUse the write has not landed yet.
test("ignore cache: a .prettierignore written through the hooks takes effect on the next format", async () => {
  const cwd = tmp("uf-ign-post-");
  const fp = path.join(cwd, "late.json");
  const before = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } })));
  assert.equal(preContent(before), '{ "a": 1 }\n', "no ignore file yet -> formatted");

  const ign = path.join(cwd, ".prettierignore");
  writeFileSync(ign, "late.json\n");
  await formatPost(/** @type {any} */ (hookInput({ cwd, tool_name: "Write", tool_input: { file_path: ign } })));

  const after = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } }));
  assert.deepEqual(after, {}, "formatPost on .prettierignore must re-read this cwd's ignore state");
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

// A `cd` is not a Write/Edit, so nothing else would ever re-read the new directory's ignore
// files. cwd_changed reads them at the moment of the change (and drops the old directory's entry
// so the Map does not grow for the process lifetime). Also the only exit from the out-of-band
// trade-off short of a server restart.
test("cwd_changed: entering a directory re-reads its ignore files", async () => {
  const a = tmp("uf-cwd-a-");
  const b = tmp("uf-cwd-b-");
  const fp = path.join(a, "later.json");
  const primed = /** @type {any} */ (await formatPre(hookInput({ cwd: a, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } })));
  assert.equal(preContent(primed), '{ "a": 1 }\n', "no ignore file yet -> formatted");

  writeFileSync(path.join(a, ".prettierignore"), "later.json\n"); // out of band, no Write/Edit hook fires
  assert.deepEqual(await cwdChanged(cwdChangedInput({ old_cwd: b, new_cwd: a })), {}, "cwd_changed always returns {}");

  const after = await formatPre(hookInput({ cwd: a, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } }));
  assert.deepEqual(after, {}, "cwd_changed must have re-read the new cwd's ignore files");
});

// Reproduces a live bug: EnterWorktree switches a background-job session's cwd into a worktree,
// but CwdChanged has been observed (real session transcript, no CwdChanged event at all across a
// real EnterWorktree call) to never fire for it. Every later PreToolUse/PostToolUse Write|Edit
// call then keeps reporting the pre-worktree cwd, so isExcludedPath misclassifies the session's
// OWN active worktree as another agent's scratch state (`.claude/worktrees/...`) and formatting
// silently stops. worktreeEntered (PostToolUse:EnterWorktree) is the fallback signal that DOES
// fire; these tests MUST run last in this file. The override it raises is keyed by
// agent_id/session_id (never a bare global — see handlers.ts's `cwdOverrides` comment), and most
// calls below use hookInput()'s hardcoded "test-session" and no agent_id, so they share ONE key
// and would still leak into any test placed after them.
// A dedicated session_id on every call here, not hookInput()'s shared "test-session" default: the
// `cwd_changed` test above raises an override under that shared key, and resolveCwd would hand this
// test THAT directory instead of `outer`. Until this change an outside-cwd file was gated to {}
// either way, so the leak was invisible; now the first assertion below really does depend on `cwd`
// being `outer`, so the key has to be its own (same reasoning as the concurrency test at the end).
test("worktree_entered: before the fix, a stale outer cwd misclassifies a worktree-nested file as excluded", async () => {
  const outer = tmp("uf-outer-");
  const worktreeDir = path.join(outer, ".claude", "worktrees", "my-worktree");
  mkdirSync(worktreeDir, { recursive: true });
  const fp = path.join(worktreeDir, "a.json");
  const session_id = "uf-worktree-session-1";

  const before = await formatPre({ ...hookInput({ cwd: outer, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1,"b":2}' } }), session_id });
  assert.deepEqual(before, {}, "relative to the stale outer cwd this looks like another agent's worktree scratch state");

  await worktreeEntered(/** @type {any} */ ({ ...hookInput({ cwd: outer, tool_name: "EnterWorktree", tool_input: {} }), session_id, tool_response: { worktreePath: worktreeDir } }));

  const after = /** @type {any} */ (
    await formatPre({ ...hookInput({ cwd: outer, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1,"b":2}' } }), session_id })
  );
  assert.equal(preContent(after), '{ "a": 1, "b": 2 }\n', "override must resolve the file relative to the worktree, ignoring the stale outer cwd");
});

// A stub "goimports" that deterministically rewrites its target file, so a real format and a
// same-shaped {} no-op (which formatPost also returns for an excluded/unresolvable path, or for
// "no formatter on PATH") are distinguishable from the test's own assertions -- {} alone would
// pass even if the cwd override were silently broken and the file were still misclassified as
// excluded. onPath()'s PATH probe is cached for the process lifetime (see util.ts), so this must
// be the first (and only) place in this file that probes "goimports"/"gofmt".
const STUB_GO_OUTPUT = "package main\n\n// stub-formatted\n";

/** Installs an executable `goimports` stub on `process.env.PATH` for the duration of `fn`,
 * restoring the original PATH afterward even if `fn` throws. @param {() => Promise<void>} fn */
async function withGoimportsStub(fn) {
  const binDir = tmp("uf-stub-bin-");
  const stub = path.join(binDir, "goimports");
  // A heredoc, not `printf '%s' "<escaped>"`: printf does not interpret backslash escapes inside
  // a substituted argument (only inside the format operand itself), so a JSON-escaped `\n` would
  // land in the target file as a literal backslash-n instead of a real newline.
  writeFileSync(stub, `#!/bin/sh\ncat > "$2" <<'STUBEOF'\n${STUB_GO_OUTPUT}STUBEOF\n`);
  chmodSync(stub, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
  try {
    await fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

test("worktree_entered: format_post also resolves against the override, not the stale cwd", async () => {
  const outer = tmp("uf-outer2-");
  const worktreeDir = path.join(outer, ".claude", "worktrees", "another-worktree");
  mkdirSync(worktreeDir, { recursive: true });
  const goFile = path.join(worktreeDir, "main.go");
  writeFileSync(goFile, "package main\n");

  await worktreeEntered(/** @type {any} */ ({ ...hookInput({ cwd: outer, tool_name: "EnterWorktree", tool_input: {} }), tool_response: { worktreePath: worktreeDir } }));

  await withGoimportsStub(async () => {
    const result = /** @type {any} */ (await formatPost(/** @type {any} */ (hookInput({ cwd: outer, tool_name: "Write", tool_input: { file_path: goFile } }))));
    assert.equal(result?.hookSpecificOutput?.hookEventName, "PostToolUse", "the stub must actually have run -- a same-shaped {} would also pass if the override were silently broken");
    assert.equal(readFileSync(goFile, "utf8"), STUB_GO_OUTPUT, "the stub ran against the worktree-resolved file, proving the override (not the stale outer cwd) was used");
  });
});

test("worktree_entered: no tool_response.worktreePath falls back to cwd", async () => {
  const dir = tmp("uf-fallback-");
  const fp = path.join(dir, "b.json");
  await worktreeEntered(/** @type {any} */ (hookInput({ cwd: dir, tool_name: "EnterWorktree", tool_input: {} })));
  const result = /** @type {any} */ (await formatPre(hookInput({ cwd: dir, tool_name: "Write", tool_input: { file_path: fp, content: '{"c":3}' } })));
  assert.equal(preContent(result), '{ "c": 3 }\n', "falling back to cwd must still resolve correctly");
});

// The concurrency case: this MCP server is one long-lived process shared by every subagent in the
// session (see ignoreCache/projectConfigCache's own "concurrent in-flight hook calls from
// sub-agents" comment in prettier.ts). Two subagents, each isolated into its OWN worktree via
// EnterWorktree, both report the SAME (stale) outer cwd but must never share one cwd override —
// a bare global would let whichever subagent's EnterWorktree ran last win for BOTH of them.
test("worktree_entered: concurrent subagents keep independent overrides, keyed by agent_id", async () => {
  const outer = tmp("uf-concurrent-outer-");
  const worktreeA = path.join(outer, ".claude", "worktrees", "agent-a-wt");
  const worktreeB = path.join(outer, ".claude", "worktrees", "agent-b-wt");
  mkdirSync(worktreeA, { recursive: true });
  mkdirSync(worktreeB, { recursive: true });
  const fpA = path.join(worktreeA, "a.json");
  const fpB = path.join(worktreeB, "b.json");

  await worktreeEntered(/** @type {any} */ ({ ...hookInput({ cwd: outer, tool_name: "EnterWorktree", tool_input: {} }), agent_id: "agent-A", tool_response: { worktreePath: worktreeA } }));
  await worktreeEntered(/** @type {any} */ ({ ...hookInput({ cwd: outer, tool_name: "EnterWorktree", tool_input: {} }), agent_id: "agent-B", tool_response: { worktreePath: worktreeB } }));

  const resultA = /** @type {any} */ (await formatPre({ ...hookInput({ cwd: outer, tool_name: "Write", tool_input: { file_path: fpA, content: '{"a":1}' } }), agent_id: "agent-A" }));
  const resultB = /** @type {any} */ (await formatPre({ ...hookInput({ cwd: outer, tool_name: "Write", tool_input: { file_path: fpB, content: '{"b":2}' } }), agent_id: "agent-B" }));

  assert.equal(preContent(resultA), '{ "a": 1 }\n', "agent A's file resolves against ITS OWN worktree override");
  assert.equal(preContent(resultB), '{ "b": 2 }\n', "agent B's file resolves against ITS OWN worktree override, unaffected by agent A's");

  // A call under a DIFFERENT session_id (a genuinely distinct parent session, not either
  // subagent's agent_id) must be untouched by both subagents' overrides. A dedicated session_id
  // here, not hookInput()'s shared "test-session" default -- other tests earlier in this file
  // also key on "test-session" and would otherwise make this assertion depend on file ordering.
  const dirC = tmp("uf-parent-");
  const fpC = path.join(dirC, "c.json");
  const resultC = /** @type {any} */ (
    await formatPre({ ...hookInput({ cwd: dirC, tool_name: "Write", tool_input: { file_path: fpC, content: '{"c":3}' } }), session_id: "concurrency-parent-session" })
  );
  assert.equal(preContent(resultC), '{ "c": 3 }\n', "an unrelated session's own calls are unaffected by either subagent's override");
});

// Out-of-cwd absolute write into a SIBLING agent's worktree, with no override raised for THIS
// session/agent: resolveBase's git-root walk lands directly on the worktree root (its `.git` is a
// FILE), which would erase `.claude/worktrees` from a base-relative `rel`. isClaudeInternalPath's
// absolute-path check (gated on base !== cwd) must still exclude it -- this agent never entered
// that worktree, so it must not reformat another agent's in-flight scratch state.
test("out-of-cwd absolute write into a sibling agent's worktree is still excluded (no override raised here)", async () => {
  const cwd = tmp("uf-sibling-cwd-");
  const siblingRepo = tmp("uf-sibling-repo-");
  const siblingWorktree = path.join(siblingRepo, ".claude", "worktrees", "other-agent-wt");
  mkdirSync(siblingWorktree, { recursive: true });
  writeFileSync(path.join(siblingWorktree, ".git"), "gitdir: /elsewhere/.git/worktrees/other-agent-wt\n");
  const fp = path.join(siblingWorktree, "a.json");

  const result = /** @type {any} */ (
    await formatPre({ ...hookInput({ cwd, tool_name: "Write", tool_input: { file_path: fp, content: '{"a":1}' } }), session_id: "uf-sibling-worktree-session" })
  );
  assert.deepEqual(result, {}, "a sibling agent's worktree must stay excluded even though resolveBase anchors base at its own root");
});
