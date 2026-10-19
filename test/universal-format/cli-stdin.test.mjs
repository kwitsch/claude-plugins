import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatPre } from "../../plugins/universal-format/mcp/server.mjs";

// The CLI languages (Kotlin/Python/Go/Rust) in stdin mode, driven through the built artifact with a
// stub formatter. Its own file on purpose: onPath()'s PATH probe is cached per tool name for the
// process lifetime (util.ts), so the FIRST probe of "goimports"/"gofmt" in this process must happen
// with the stub directory on PATH -- in prettier.test.mjs a real gofmt on the machine would win.

/** @param {string} prefix @returns {string} */
function tmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** @param {{cwd:string, tool_name:string, tool_input:Record<string,unknown>}} p @returns {ToolHookInput} */
function hookInput(p) {
  return { session_id: "test-session", transcript_path: "/dev/null", cwd: p.cwd, permission_mode: "default", hook_event_name: "PreToolUse", tool_name: p.tool_name, tool_input: p.tool_input };
}

/** @param {any} res @returns {string} */
const preContent = (res) => res.hookSpecificOutput.updatedInput.content;

// The handler feeds the would-be content to the tool on stdin and hands its stdout back as
// updatedInput, exactly like the prettier path. A stub goimports that records its argv and prints a
// deterministic result makes a real stdin-mode format distinguishable from a same-shaped {} (no tool
// on PATH / excluded path). A gofmt stub sits next to it so the chain can never fall through to a
// real gofmt on the machine.
const STUB_GO_OUTPUT = "package main\n\n// stub-formatted\n";

/** Installs an executable `goimports` stub on `process.env.PATH` for the duration of `fn`, restoring
 * the original PATH afterward even if `fn` throws. The stub appends its argv to `argvLog`, drains
 * stdin and prints STUB_GO_OUTPUT (a heredoc, so the newlines are real), exiting with `exitCode`.
 * @param {{ argvLog: string, exitCode?: number, silent?: boolean }} opts @param {() => Promise<void>} fn */
async function withGoimportsStub(opts, fn) {
  const binDir = tmp("uf-stub-bin-");
  const body = opts.silent ? "" : `cat <<'STUBEOF'\n${STUB_GO_OUTPUT}STUBEOF\n`;
  for (const name of ["goimports", "gofmt"]) {
    const stub = path.join(binDir, name);
    writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${opts.argvLog}"\ncat >/dev/null\n${body}exit ${opts.exitCode ?? 0}\n`);
    chmodSync(stub, 0o755);
  }
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
  try {
    await fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

test("CLI language Write: goimports is fed the content on stdin, named the file via -srcdir, and its stdout becomes updatedInput", async () => {
  const cwd = tmp("uf-cli-write-");
  const goFile = path.join(cwd, "main.go");
  const argvLog = path.join(cwd, "argv.log");
  await withGoimportsStub({ argvLog }, async () => {
    const result = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: goFile, content: "package   main\n" } })));
    assert.equal(preContent(result), STUB_GO_OUTPUT);
    assert.equal(result.hookSpecificOutput.updatedInput.file_path, goFile);
    assert.match(result.hookSpecificOutput.additionalContext, /^universal-format: goimports reformatted main\.go; re-read it/);
    assert.equal(readFileSync(argvLog, "utf8"), `-srcdir ${goFile}\n`, "no -w, no file argument: the content travels on stdin");
    assert.equal(existsSync(goFile), false, "the hook never writes the file itself");
  });
});

test("CLI language Edit: the merged file is formatted on stdin and only the changed run of lines is swapped", async () => {
  const cwd = tmp("uf-cli-edit-");
  const goFile = path.join(cwd, "main.go");
  writeFileSync(goFile, "package main\n");
  const argvLog = path.join(cwd, "argv.log");
  await withGoimportsStub({ argvLog }, async () => {
    const result = /** @type {any} */ (await formatPre(hookInput({ cwd, tool_name: "Edit", tool_input: { file_path: goFile, old_string: "package main", new_string: "package   main" } })));
    assert.deepEqual(result.hookSpecificOutput.updatedInput, { file_path: goFile, old_string: "package main\n", new_string: STUB_GO_OUTPUT, replace_all: false });
    assert.match(result.hookSpecificOutput.additionalContext, /goimports reformatted main\.go/);
    assert.equal(readFileSync(goFile, "utf8"), "package main\n", "the hook never writes the file itself");
  });
});

test("CLI language: an exit code outside the tool's okExit, or an empty stdout, fails open to {}", async () => {
  const cwd = tmp("uf-cli-fail-");
  const goFile = path.join(cwd, "main.go");
  const argvLog = path.join(cwd, "argv.log");
  await withGoimportsStub({ argvLog, exitCode: 2 }, async () => {
    assert.deepEqual(await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: goFile, content: "package main\n" } })), {}, "exit 2 with output -> {}");
  });
  await withGoimportsStub({ argvLog, silent: true }, async () => {
    assert.deepEqual(await formatPre(hookInput({ cwd, tool_name: "Write", tool_input: { file_path: goFile, content: "package main\n" } })), {}, "exit 0 with empty stdout -> {}");
  });
});
