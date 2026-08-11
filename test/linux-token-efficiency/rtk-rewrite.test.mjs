import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isAutoRewriteEnabled, resolveRtkOnPath, sameFile, buildUpdatedInput } from "../../plugins/linux-token-efficiency/hooks/rtk-rewrite.mjs";

/** @param {string} dir @param {string} name @returns {string} */
function makeExecutable(dir, name) {
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  writeFileSync(p, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(p, 0o755);
  return p;
}

test("isAutoRewriteEnabled: only the literal false disables (fail-open)", () => {
  assert.equal(isAutoRewriteEnabled("false"), false);
  assert.equal(isAutoRewriteEnabled("  false  "), false);
  assert.equal(isAutoRewriteEnabled(undefined), true);
  assert.equal(isAutoRewriteEnabled(""), true);
  assert.equal(isAutoRewriteEnabled("true"), true);
  assert.equal(isAutoRewriteEnabled("${user_config.auto_rewrite}"), true);
  assert.equal(isAutoRewriteEnabled("False"), true);
});

test("resolveRtkOnPath: returns the first executable rtk, honoring PATH order", () => {
  const root = mkdtempSync(path.join(tmpdir(), "lte-path-"));
  const first = path.join(root, "a");
  const second = path.join(root, "b");
  makeExecutable(second, "rtk");
  const empty = path.join(root, "empty");
  mkdirSync(empty, { recursive: true });
  assert.equal(resolveRtkOnPath([first, second].join(path.delimiter)), path.join(second, "rtk"));
  makeExecutable(first, "rtk");
  assert.equal(resolveRtkOnPath([first, second].join(path.delimiter)), path.join(first, "rtk"));
  assert.equal(resolveRtkOnPath([empty].join(path.delimiter)), null);
});

test("resolveRtkOnPath: null for empty, undefined and non-executable candidates", () => {
  const root = mkdtempSync(path.join(tmpdir(), "lte-path2-"));
  mkdirSync(root, { recursive: true });
  const notExec = path.join(root, "rtk");
  writeFileSync(notExec, "not executable\n");
  chmodSync(notExec, 0o644);
  assert.equal(resolveRtkOnPath(undefined), null);
  assert.equal(resolveRtkOnPath(""), null);
  assert.equal(resolveRtkOnPath(`${path.delimiter}${path.delimiter}`), null);
  assert.equal(resolveRtkOnPath(root), null);
});

test("sameFile: true through a symlink, false for distinct files and missing paths", () => {
  const root = mkdtempSync(path.join(tmpdir(), "lte-same-"));
  const real = makeExecutable(path.join(root, "bin"), "rtk");
  const other = makeExecutable(path.join(root, "global"), "rtk");
  const link = path.join(root, "link-rtk");
  symlinkSync(real, link);
  assert.equal(sameFile(real, link), true);
  assert.equal(sameFile(real, other), false);
  assert.equal(sameFile(real, path.join(root, "nope")), false);
});

test("buildUpdatedInput: forwards every field, replaces only command, no permissionDecision", () => {
  const toolInput = {
    command: "ls -la /tmp",
    description: "list",
    timeout: 600000,
    run_in_background: true,
    future_field: "keep-me",
  };
  const result = buildUpdatedInput(toolInput, "rtk ls -la /tmp");
  assert.deepEqual(result, {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecisionReason: "rtk auto-rewrite (bundled)",
      updatedInput: {
        command: "rtk ls -la /tmp",
        description: "list",
        timeout: 600000,
        run_in_background: true,
        future_field: "keep-me",
      },
    },
  });
  assert.equal("permissionDecision" in (result.hookSpecificOutput ?? {}), false);
  assert.equal(toolInput.command, "ls -la /tmp", "the original object must not be mutated");
});
