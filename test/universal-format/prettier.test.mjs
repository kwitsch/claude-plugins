import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { formatInProcess, applyEdit, resolvePrettierSource, readManagedPrettierVersion, shouldRunDailyCheck, formatPre } from "../../plugins/universal-format/mcp/server.mjs";

const require = createRequire(import.meta.url);
/** @type {string|null} */
let PRETTIER_PKG_DIR = null;
/** @type {string|null} */
let PRETTIER_ENTRY = null;
try {
  PRETTIER_PKG_DIR = path.dirname(require.resolve("prettier/package.json"));
  PRETTIER_ENTRY = require.resolve("prettier");
} catch {
  /* prettier not resolvable from the repo */
}
const maybe = PRETTIER_PKG_DIR ? test : test.skip;

/** @param {string} prefix @returns {string} */
function tmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}
function projectWithPrettier() {
  const cwd = tmp("uf-proj-");
  const nm = path.join(cwd, "node_modules");
  mkdirSync(nm, { recursive: true });
  symlinkSync(PRETTIER_PKG_DIR, path.join(nm, "prettier"), "dir");
  return cwd;
}
// A tier-1 project whose prettier is a REAL package under cwd (not a symlink to the
// shared repo copy). require.resolve follows symlinks to their realpath, so a symlinked
// project copy resolves back to the shared repo dir -- the exact same realpath the managed
// (tier-3) copy also symlinks to -- making the two tiers indistinguishable by modulePath.
// A real package under cwd resolves to a cwd-prefixed path, the only way to prove tier-1
// was chosen over tier-3. Resolution-only fixture (never executed by prettier).
function projectWithLocalPrettierPackage() {
  const cwd = tmp("uf-proj-local-");
  const pdir = path.join(cwd, "node_modules", "prettier");
  mkdirSync(pdir, { recursive: true });
  writeFileSync(path.join(pdir, "package.json"), JSON.stringify({ name: "prettier", version: "0.0.0-local", main: "index.js" }));
  writeFileSync(path.join(pdir, "index.js"), "module.exports={};\n");
  return cwd;
}
async function repoPrettier() {
  const mod = await import(pathToFileURL(/** @type {string} */ (PRETTIER_ENTRY)).href);
  return mod?.default ?? mod;
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

maybe("formatInProcess formats js/json/yaml/markdown", async () => {
  const prettier = await repoPrettier();
  const cwd = tmp("uf-fmt-");
  const js = await formatInProcess(prettier, "let x=1", path.join(cwd, "a.js"), cwd, "jsts");
  assert.equal(js, "let x = 1;\n");
  const json = await formatInProcess(prettier, '{"a":1}', path.join(cwd, "a.json"), cwd, "json");
  assert.equal(json, '{ "a": 1 }\n');
  const md = await formatInProcess(prettier, "#  Title\n", path.join(cwd, "a.md"), cwd, "markdown");
  assert.equal(md, "# Title\n");
});

maybe("json printWidth override: no config -> unbounded (long array not wrapped)", async () => {
  const prettier = await repoPrettier();
  const cwd = tmp("uf-pw-");
  const long = JSON.stringify([...Array(40).keys()]);
  const out = await formatInProcess(prettier, long, path.join(cwd, "a.json"), cwd, "json");
  assert.ok(!out.includes("\n  0"), "no-config json should not wrap the array onto multiple lines");
});

maybe("json printWidth override: .prettierrc printWidth honored", async () => {
  const prettier = await repoPrettier();
  const cwd = tmp("uf-pw2-");
  writeFileSync(path.join(cwd, ".prettierrc"), JSON.stringify({ printWidth: 20 }));
  const long = JSON.stringify([...Array(40).keys()]);
  const out = await formatInProcess(prettier, long, path.join(cwd, "a.json"), cwd, "json");
  assert.ok(out.includes("\n"), "a project printWidth must be honored (array wraps)");
});

maybe("clearConfigCache: a mid-run .prettierrc change takes effect", async () => {
  const prettier = await repoPrettier();
  const cwd = tmp("uf-ccc-");
  const long = JSON.stringify([...Array(40).keys()]);
  const first = await formatInProcess(prettier, long, path.join(cwd, "a.json"), cwd, "json");
  assert.ok(!first.includes("\n  0"));
  writeFileSync(path.join(cwd, ".prettierrc"), JSON.stringify({ printWidth: 20 }));
  const second = await formatInProcess(prettier, long, path.join(cwd, "a.json"), cwd, "json");
  assert.ok(second.includes("\n"), "the new .prettierrc must take effect after clearConfigCache");
});

test("applyEdit: replace_all, single swap, null on absent and non-unique", () => {
  assert.equal(applyEdit("a a a", "a", "b", true), "b b b");
  assert.equal(applyEdit("xAy", "A", "Z", false), "xZy");
  assert.equal(applyEdit("no match", "Q", "Z", false), null);
  assert.equal(applyEdit("a a", "a", "b", false), null); // non-unique
  assert.equal(applyEdit("nope", "Q", "Z", true), null); // replace_all, absent
});

// An empty old_string "matches" under both includes() and indexOf(), so without an
// explicit guard the replace_all branch would splice new_string between every character
// of the file and hand that whole-file swap back as updatedInput.
test("applyEdit: empty old_string is rejected on both branches", () => {
  assert.equal(applyEdit("abc", "", "X", false), null);
  assert.equal(applyEdit("abc", "", "X", true), null);
});

// shouldOverridePrintWidth's own cases live unconditionally in registry.test.mjs; they
// were duplicated here behind `maybe` (strictly weaker: skipped when prettier is absent).

maybe("format_pre Write: updatedInput.content formatted, no permissionDecision", async () => {
  const cwd = projectWithPrettier();
  const res = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "a.json"), content: '{"a":1}' } })));
  assert.equal(res.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(res.hookSpecificOutput.updatedInput.content, '{ "a": 1 }\n');
  assert.equal(res.hookSpecificOutput.updatedInput.file_path, path.join(cwd, "a.json"));
  assert.ok(!("permissionDecision" in res.hookSpecificOutput), "format_pre must never set permissionDecision");
  assert.ok(typeof res.hookSpecificOutput.additionalContext === "string");
});

// Parity with the subprocess path: `prettier --write <file>` filters even an explicitly
// named file through --ignore-path ([.gitignore, .prettierignore]). getFileInfo does not
// auto-discover those, so the in-process path must pass them itself.
maybe("format_pre: a .prettierignore'd file is left alone", async () => {
  const cwd = projectWithPrettier();
  writeFileSync(path.join(cwd, ".prettierignore"), "ignored.json\n");
  const plain = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "kept.json"), content: '{"a":1}' } })));
  assert.ok(plain.hookSpecificOutput, "a non-ignored file is still formatted");
  const res = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "ignored.json"), content: '{"a":1}' } }));
  assert.deepEqual(res, {});
});

maybe("format_pre: a .gitignore'd file is left alone", async () => {
  const cwd = projectWithPrettier();
  writeFileSync(path.join(cwd, ".gitignore"), "generated.json\n");
  const res = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "generated.json"), content: '{"a":1}' } }));
  assert.deepEqual(res, {});
});

maybe("format_pre Edit: whole-file swap old_string=full pre-edit, new_string=formatted, replace_all false", async () => {
  const cwd = projectWithPrettier();
  const fp = path.join(cwd, "a.json");
  writeFileSync(fp, '{ "a": 1 }\n');
  const res = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Edit", tool_input: { file_path: fp, old_string: '"a": 1', new_string: '"a":2' } })));
  assert.equal(res.hookSpecificOutput.updatedInput.old_string, '{ "a": 1 }\n');
  assert.equal(res.hookSpecificOutput.updatedInput.new_string, '{ "a": 2 }\n');
  assert.equal(res.hookSpecificOutput.updatedInput.replace_all, false);
  assert.ok(!("permissionDecision" in res.hookSpecificOutput));
});

maybe("format_pre Edit: absent old_string -> {}", async () => {
  const cwd = projectWithPrettier();
  const fp = path.join(cwd, "a.json");
  writeFileSync(fp, '{ "a": 1 }\n');
  const res = await formatPre(hookInput({ cwd, tool_name: "Edit", tool_input: { file_path: fp, old_string: "NOT PRESENT", new_string: "x" } }));
  assert.deepEqual(res, {});
});

maybe("format_pre: non-prettier ext and excluded path -> {} even in a tier-1 project", async () => {
  const cwd = projectWithPrettier();
  const sh = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "a.sh"), content: "echo hi" } }));
  assert.deepEqual(sh, {});
  mkdirSync(path.join(cwd, "node_modules", "pkg"), { recursive: true });
  const nm = await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "node_modules", "pkg", "a.json"), content: '{"a":1}' } }));
  assert.deepEqual(nm, {});
});

maybe("tier ordering: tier-1 project prettier wins even when a managed copy exists", async () => {
  const cwd = projectWithLocalPrettierPackage();
  const data = tmp("uf-data-");
  const vdir = path.join(data, "prettier", "versions", "x");
  mkdirSync(path.join(vdir, "node_modules"), { recursive: true });
  symlinkSync(PRETTIER_PKG_DIR, path.join(vdir, "node_modules", "prettier"), "dir");
  symlinkSync(vdir, path.join(data, "prettier", "current"), "dir");
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = data;
  try {
    const src = resolvePrettierSource(cwd);
    assert.equal(src.kind, "in-process");
    assert.ok(/** @type {any} */ (src).modulePath.startsWith(cwd), "tier-1 module path must be the project-local prettier");
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prev;
  }
});

maybe("tier-3: managed copy resolves in-process and format_pre formats via it", async () => {
  const cwd = tmp("uf-noproj-"); // no project prettier
  const data = tmp("uf-data3-");
  const vdir = path.join(data, "prettier", "versions", "m");
  mkdirSync(path.join(vdir, "node_modules"), { recursive: true });
  symlinkSync(PRETTIER_PKG_DIR, path.join(vdir, "node_modules", "prettier"), "dir");
  symlinkSync(vdir, path.join(data, "prettier", "current"), "dir");
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  const prevPath = process.env.PATH;
  process.env.CLAUDE_PLUGIN_DATA = data;
  // This fixture asserts tier-2 (PATH prettier) is absent so resolution falls through
  // to tier-3 (the managed copy). Under `npm run`/`pnpm run` the repo's own PATH is
  // prefixed with node_modules/.bin, which contains this repo's prettier devDependency
  // -- onPath("prettier") would otherwise see that binary and report tier-2 (a
  // test-runner artifact, not a real project-local/PATH prettier), never reaching
  // tier-3 at all. Isolate PATH to a value with no "prettier" executable for the
  // resolution call, matching this suite's hermetic-PATH convention.
  // NOTE: onPath() memoises its probe in a module-level cache, so clearing PATH only
  // works while no earlier test in this file has already probed "prettier" with a
  // populated PATH. Every earlier resolvePrettierSource() call here resolves at tier 1
  // (project-local, returns before any PATH probe), so the cache stays empty until this
  // point. Keep it that way — a new tier-2 test placed above this one would poison it.
  process.env.PATH = "";
  try {
    const src = resolvePrettierSource(cwd);
    assert.equal(src.kind, "in-process");
    const res = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "a.json"), content: '{"a":1}' } })));
    assert.equal(res.hookSpecificOutput.updatedInput.content, '{ "a": 1 }\n');
    assert.equal(readManagedPrettierVersion(path.join(data, "prettier")), require("prettier/package.json").version);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prev;
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
  }
});

test("shouldRunDailyCheck: null and >=24h true; <24h false", () => {
  const now = 1_000_000_000_000;
  assert.equal(shouldRunDailyCheck(null, now), true);
  assert.equal(shouldRunDailyCheck(now - 24 * 60 * 60 * 1000, now), true);
  assert.equal(shouldRunDailyCheck(now - 60 * 1000, now), false);
});
