import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatPre, formatPost } from "../../plugins/universal-format/mcp/server.mjs";

// The dprint priority gate (handlers.ts dprintGoverns). Its own file because every test here
// points $HOME (and so os.homedir(), the user-scope settings anchor) at a fresh tmp dir: each
// `node --test` file is its own process, so the override never leaks into the other suites, and
// the developer's real ~/.claude/settings.json never leaks in here. Every test uses its own tmp
// cwd, so dprintConfigCache (keyed by cwd) never carries a verdict between tests. These tests
// assume no `.git` entry and no dprint config exist above os.tmpdir().

const UNFORMATTED = "const a={b:1}";
const FORMATTED = "const a = { b: 1 };\n";
const ENABLED = { enabledPlugins: { "dprint@kwitsch-plugins": true } };

/** @param {string} prefix @returns {string} */
function tmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
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

/** Writes a settings file: an object is JSON-encoded, a string is written verbatim (malformed cases).
 * @param {string} file @param {unknown} settings @returns {void} */
function writeSettings(file, settings) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof settings === "string" ? settings : JSON.stringify(settings));
}

/** Points os.homedir() at a fresh tmp dir; writes its ~/.claude/settings.json when given.
 * @param {unknown} [settings] @returns {string} */
function freshHome(settings) {
  const home = tmp("uf-dg-home-");
  process.env.HOME = home;
  if (settings !== undefined) writeSettings(path.join(home, ".claude", "settings.json"), settings);
  return home;
}

/** @param {string} dir @param {string} [name] @returns {void} */
function writeDprintConfig(dir, name = "dprint.json") {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "{}\n");
}

/** formatPre for a Write of the unformatted .ts fixture. @param {string} cwd @param {string} [file] @returns {Promise<any>} */
async function preWrite(cwd, file = path.join(cwd, "a.ts")) {
  return /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: file, content: UNFORMATTED } })));
}

/** @param {any} res @param {string} msg @returns {void} */
function assertFormatted(res, msg) {
  assert.equal(res?.hookSpecificOutput?.updatedInput?.content, FORMATTED, msg);
}

// Copied verbatim from prettier.test.mjs (file-local there, deliberately not exported). A stub
// "goimports" that deterministically rewrites its target file, so a real format and a same-shaped
// {} no-op (which formatPost also returns for "no formatter on PATH") are distinguishable.
// onPath()'s PATH probe is cached for the process lifetime (see util.ts), so this must be the
// first (and only) place in this file that probes "goimports"/"gofmt".
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

test("dprint gate: dprint.json in cwd + dprint enabled at user scope -> format_pre returns {}", async () => {
  freshHome(ENABLED);
  const cwd = tmp("uf-dg-basic-");
  writeDprintConfig(cwd);
  assert.deepEqual(await preWrite(cwd), {}, "dprint governs this cwd: universal-format must format nothing");
});

test("dprint gate: the .config/dprint.jsonc variant counts as a dprint config", async () => {
  freshHome(ENABLED);
  const cwd = tmp("uf-dg-dotconfig-");
  writeDprintConfig(cwd, path.join(".config", "dprint.jsonc"));
  assert.deepEqual(await preWrite(cwd), {}, ".config/dprint.jsonc is one of dprint's six CONFIG_NAMES");
});

test("dprint gate: a config in a parent dir of cwd is found when no .git sits between them", async () => {
  freshHome(ENABLED);
  const parent = tmp("uf-dg-walkup-");
  writeDprintConfig(parent);
  const cwd = path.join(parent, "child");
  mkdirSync(cwd);
  assert.deepEqual(await preWrite(cwd), {}, "dprint's findConfig walks up from cwd until a .git directory");
});

test("dprint gate: the walk stops at a cwd holding .git, so a config above it does not count", async () => {
  freshHome(ENABLED);
  const parent = tmp("uf-dg-gitstop-");
  writeDprintConfig(parent);
  const cwd = path.join(parent, "repo");
  mkdirSync(path.join(cwd, ".git"), { recursive: true });
  assertFormatted(await preWrite(cwd), "dprint parity: the walk ends after the directory holding .git");
});

test("dprint gate: no dprint@ entry in enabledPlugins at any scope -> still formatted", async () => {
  freshHome({ enabledPlugins: { "universal-format@kwitsch-plugins": true } });
  const cwd = tmp("uf-dg-noentry-");
  writeDprintConfig(cwd);
  assertFormatted(await preWrite(cwd), "no dprint@ key anywhere means dprint is not active");
});

test("dprint gate: the most specific settings file wins (local > project > user)", async () => {
  freshHome(ENABLED);
  const projectOff = tmp("uf-dg-prec-project-");
  writeDprintConfig(projectOff);
  writeSettings(path.join(projectOff, ".claude", "settings.json"), { enabledPlugins: { "dprint@kwitsch-plugins": false } });
  assertFormatted(await preWrite(projectOff), "project-scope false overrides user-scope true");

  const localOn = tmp("uf-dg-prec-local-");
  writeDprintConfig(localOn);
  writeSettings(path.join(localOn, ".claude", "settings.json"), { enabledPlugins: { "dprint@kwitsch-plugins": false } });
  writeSettings(path.join(localOn, ".claude", "settings.local.json"), { enabledPlugins: { "dprint@kwitsch-plugins": true } });
  assert.deepEqual(await preWrite(localOn), {}, "local-scope true overrides project-scope false");
});

test("dprint gate: no dprint config, dprint enabled -> still formatted", async () => {
  freshHome(ENABLED);
  const cwd = tmp("uf-dg-noconfig-");
  assertFormatted(await preWrite(cwd), "dprint enabled but nothing for it to format here");
});

test("dprint gate: a malformed user settings file fails toward formatting", async () => {
  freshHome("{");
  const cwd = tmp("uf-dg-malformed-");
  writeDprintConfig(cwd);
  assertFormatted(await preWrite(cwd), "unreadable settings must never silence universal-format");
});

test("dprint gate: an out-of-cwd write is formatted even when cwd is dprint-governed", async () => {
  freshHome(ENABLED);
  const cwd = tmp("uf-dg-outer-cwd-");
  writeDprintConfig(cwd);
  const other = tmp("uf-dg-outer-other-");
  mkdirSync(path.join(other, ".git"));
  assertFormatted(await preWrite(cwd, path.join(other, "a.ts")), "base !== cwd: dprint's hook would not touch this file");
});

test("dprint gate: format_post runs no CLI formatter in a dprint-governed cwd (stub-proven), a non-dprint cwd still does", async () => {
  freshHome(ENABLED);
  const governed = tmp("uf-dg-post-gov-");
  writeDprintConfig(governed);
  const govFile = path.join(governed, "main.go");
  writeFileSync(govFile, "package main\n");
  const plain = tmp("uf-dg-post-plain-");
  const plainFile = path.join(plain, "main.go");
  writeFileSync(plainFile, "package main\n");

  await withGoimportsStub(async () => {
    const gated = await formatPost(/** @type {any} */ (hookInput({ cwd: governed, tool_name: "Write", tool_input: { file_path: govFile } })));
    assert.deepEqual(gated, {}, "dprint governs this cwd: format_post must return {}");
    assert.equal(readFileSync(govFile, "utf8"), "package main\n", "the stub must not have run -- {} alone is also what 'no formatter on PATH' returns");

    const control = /** @type {any} */ (await formatPost(/** @type {any} */ (hookInput({ cwd: plain, tool_name: "Write", tool_input: { file_path: plainFile } }))));
    assert.equal(control?.hookSpecificOutput?.hookEventName, "PostToolUse", "positive control: the stub is on PATH and runs outside a dprint-governed cwd");
    assert.equal(readFileSync(plainFile, "utf8"), STUB_GO_OUTPUT, "positive control: the gate, not a missing tool, produced the {} above");
  });
});

test("dprint gate: writing dprint.json via Write clears the cached negative verdict", async () => {
  freshHome(ENABLED);
  const cwd = tmp("uf-dg-inval-");
  assertFormatted(await preWrite(cwd), "no config yet: formatted, and the negative verdict is now cached");
  writeDprintConfig(cwd);
  await formatPost(/** @type {any} */ (hookInput({ cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "dprint.json") } })));
  assert.deepEqual(await preWrite(cwd), {}, "format_post on a dprint config basename must clear dprintConfigCache");
});
