import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isNpmCiEnabled,
  truncate,
  npmCiOnWorktreeHandler,
} from "../../plugins/coding-toolbox/hooks/npm-ci-on-worktree.mjs";

test('isNpmCiEnabled: fail-open, only literal "false" disables', () => {
  assert.equal(isNpmCiEnabled("true"), true);
  assert.equal(isNpmCiEnabled("false"), false);
  assert.equal(isNpmCiEnabled(""), true);
  assert.equal(isNpmCiEnabled(undefined), true);
  assert.equal(isNpmCiEnabled("${user_config.npm_ci_on_worktree}"), true);
});

test("truncate: passes short text through unchanged", () => {
  assert.equal(truncate("short output"), "short output");
});

test("truncate: caps long text at 4000 chars with a truncation marker", () => {
  const long = "x".repeat(5000);
  const out = truncate(long);
  assert.ok(out.length < long.length);
  assert.match(out, /\(truncated\)$/);
});

/** @param {string} cwd @returns {PostToolUseHookInput} */
function mockInput(cwd) {
  return {
    session_id: "test-session",
    transcript_path: "/dev/null",
    cwd,
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_name: "EnterWorktree",
    tool_input: {},
  };
}

test("npmCiOnWorktreeHandler: npm killed by its own timeout is silent, not misreported as missing", () => {
  const projDir = mkdtempSync(path.join(tmpdir(), "npm-ci-timeout-"));
  writeFileSync(path.join(projDir, "package-lock.json"), "");

  const binDir = mkdtempSync(path.join(tmpdir(), "npm-ci-stubbin-"));
  const npmStub = path.join(binDir, "npm");
  writeFileSync(npmStub, "#!/usr/bin/env bash\nsleep 5\n");
  chmodSync(npmStub, 0o755);

  const origPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${origPath}`;
  try {
    // 100ms timeout, stub sleeps 5s -- spawnSync sets BOTH result.error and
    // result.signal on this kill; the handler must check signal first.
    const result = npmCiOnWorktreeHandler(mockInput(projDir), 100);
    assert.deepEqual(result, {});
  } finally {
    process.env.PATH = origPath;
  }
});

test("npmCiOnWorktreeHandler: a non-ENOENT spawn error (EACCES) is not misreported as npm missing", () => {
  const projDir = mkdtempSync(path.join(tmpdir(), "npm-ci-eacces-"));
  writeFileSync(path.join(projDir, "package-lock.json"), "");

  const binDir = mkdtempSync(path.join(tmpdir(), "npm-ci-noexec-"));
  const npmStub = path.join(binDir, "npm");
  writeFileSync(npmStub, "#!/usr/bin/env bash\necho should never run\n");
  chmodSync(npmStub, 0o644); // present on PATH but not executable -- EACCES, not ENOENT

  const origPath = process.env.PATH;
  // Replace PATH entirely (not prepend) -- with the real npm still reachable
  // further down PATH, the OS's PATH search silently skips a non-executable
  // match and falls through to it, defeating the point of this test.
  process.env.PATH = binDir;
  try {
    const result = npmCiOnWorktreeHandler(mockInput(projDir));
    const message = result?.hookSpecificOutput?.additionalContext ?? "";
    assert.doesNotMatch(message, /npm not found on PATH/);
    assert.match(message, /npm ci` failed/);
    assert.match(message, /EACCES/);
  } finally {
    process.env.PATH = origPath;
  }
});
