import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import {
  isAutoRewriteEnabled,
  isSteerEnabled,
  resolveRtkOnPath,
  resolveManagedRtk,
  sameFile,
  buildUpdatedInput,
  splitTopLevel,
  commandHead,
  classifyBashCommand,
  buildSteerDeny,
} from "../../plugins/linux-token-efficiency/hooks/rtk-rewrite.mjs";
import { buildWebFetchDeny } from "../../plugins/linux-token-efficiency/hooks/webfetch-steer.mjs";

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

test("resolveManagedRtk: ${HOME}/.local/bin/rtk; falls back to os.homedir() on blank or ${-bearing HOME", () => {
  assert.equal(resolveManagedRtk({ HOME: "/home/u" }), path.join("/home/u", ".local", "bin", "rtk"));
  assert.equal(resolveManagedRtk({ HOME: "  /home/u  " }), path.join("/home/u", ".local", "bin", "rtk"));
  // HOME unusable (blank / ${-bearing / absent): falls back to os.homedir(), matching
  // rtk-install.mjs's resolveHome() so both agree on the install target in this edge case.
  const fallback = path.join(os.homedir(), ".local", "bin", "rtk");
  assert.equal(resolveManagedRtk({ HOME: "" }), fallback);
  assert.equal(resolveManagedRtk({ HOME: "   " }), fallback);
  assert.equal(resolveManagedRtk({ HOME: "${HOME}/.x" }), fallback);
  assert.equal(resolveManagedRtk({}), fallback);
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

test("buildUpdatedInput: takes no decision parameter and never emits permissionDecision", () => {
  assert.equal(buildUpdatedInput.length, 2);
  const toolInput = { command: "ls -la /tmp" };
  const result = buildUpdatedInput(toolInput, "rtk ls -la /tmp");
  assert.equal("permissionDecision" in (result.hookSpecificOutput ?? {}), false);
  assert.equal(result.hookSpecificOutput?.updatedInput?.command, "rtk ls -la /tmp");
});

test("isSteerEnabled: only the literal false disables (fail-open, same as auto_rewrite)", () => {
  assert.equal(isSteerEnabled("false"), false);
  assert.equal(isSteerEnabled("  false  "), false);
  assert.equal(isSteerEnabled(undefined), true);
  assert.equal(isSteerEnabled(""), true);
  assert.equal(isSteerEnabled("true"), true);
  assert.equal(isSteerEnabled("${user_config.steer_enabled}"), true);
});

test("splitTopLevel: flat chains and pipes split; quotes protect operators", () => {
  assert.deepEqual(splitTopLevel("grep foo a && wc -l b; cat c"), [
    { text: "grep foo a", stages: ["grep foo a"] },
    { text: "wc -l b", stages: ["wc -l b"] },
    { text: "cat c", stages: ["cat c"] },
  ]);
  assert.deepEqual(splitTopLevel("cat log | grep ERR | sort"), [{ text: "cat log | grep ERR | sort", stages: ["cat log", "grep ERR", "sort"] }]);
  const quoted = splitTopLevel('grep -e "a && b" file');
  assert.equal(quoted?.length, 1);
  assert.equal(quoted?.[0].stages[0], 'grep -e "a && b" file');
});

test("splitTopLevel: null (too complex, stay in Bash) on substitution, redirects, background, subshells, comments", () => {
  for (const cmd of [
    "grep foo $(ls)",
    "grep foo `ls`",
    "grep foo > out",
    "grep foo < in",
    "cat a 2>&1",
    "sleep 5 &",
    "(cat a; cat b)",
    "grep foo # comment",
    "cat a\ncat b",
    "grep 'unterminated",
    "&& cat a",
  ]) {
    assert.equal(splitTopLevel(cmd), null, cmd);
  }
});

test("commandHead: skips env assignments and a leading `command`", () => {
  assert.equal(commandHead("FOO=bar BAZ=1 grep -rn x"), "grep");
  assert.equal(commandHead("command cat file"), "cat");
  assert.equal(commandHead("  ls -la"), "ls");
  assert.equal(commandHead(""), "");
  assert.equal(commandHead("FOO=bar"), "");
});

test("classifyBashCommand: fetch — only a bare curl GET steers", () => {
  assert.deepEqual(classifyBashCommand("curl https://example.com/api"), { kind: "fetch", url: "https://example.com/api" });
  assert.equal(classifyBashCommand("curl -sSL https://example.com").kind, "fetch");
  // Writes, uploads, explicit methods and file outputs stay in Bash.
  for (const cmd of [
    "curl -X POST -d x https://example.com",
    "curl -o out.json https://example.com",
    "curl --data-raw x https://example.com",
    "curl --output f https://example.com",
    "curl ftp://example.com/file",
    "curl", // no URL at all
    "wget https://example.com/file", // wget's default is a file download
  ]) {
    assert.equal(classifyBashCommand(cmd).kind, "stay", cmd);
  }
});

test("classifyBashCommand: batch — >=3 all-read-only segments steer, side-effect heads stay", () => {
  assert.deepEqual(classifyBashCommand("grep foo a; wc -l b; cat c"), {
    kind: "batch",
    commands: ["grep foo a", "wc -l b", "cat c"],
  });
  assert.equal(classifyBashCommand("git status && git log && git diff").kind, "stay");
  assert.equal(classifyBashCommand("grep foo a && rm b && cat c").kind, "stay");
  assert.equal(classifyBashCommand("grep foo a && wc -l b").kind, "stay", "two segments are not enough");
  assert.equal(classifyBashCommand("echo a && echo b && echo c").kind, "stay", "echo is not a gather tool");
});

test("classifyBashCommand: pipeline — a >=3-stage all-read-only pipe steers", () => {
  assert.deepEqual(classifyBashCommand("cat log | grep ERR | sort"), {
    kind: "pipeline",
    command: "cat log | grep ERR | sort",
  });
  assert.equal(classifyBashCommand("cat log | grep ERR").kind, "stay", "two stages are not enough");
  assert.equal(classifyBashCommand("cat log | xargs rm | sort").kind, "stay", "xargs is not read-only");
});

test("buildSteerDeny: deny with a copy-ready replacement per kind; null for stay", () => {
  assert.equal(buildSteerDeny({ kind: "stay" }), null);
  const fetch = buildSteerDeny({ kind: "fetch", url: "https://example.com/a" });
  assert.equal(fetch?.hookSpecificOutput?.permissionDecision, "deny");
  assert.match(fetch?.hookSpecificOutput?.permissionDecisionReason ?? "", /ctx_fetch_and_index/);
  assert.match(fetch?.hookSpecificOutput?.permissionDecisionReason ?? "", /"source": "example\.com"/);
  const batch = buildSteerDeny({ kind: "batch", commands: ["grep a b", "wc -l c"] });
  assert.match(batch?.hookSpecificOutput?.permissionDecisionReason ?? "", /ctx_batch_execute/);
  assert.match(batch?.hookSpecificOutput?.permissionDecisionReason ?? "", /"command":"grep a b"/);
  const pipe = buildSteerDeny({ kind: "pipeline", command: "cat a | grep b | wc -l" });
  assert.match(pipe?.hookSpecificOutput?.permissionDecisionReason ?? "", /ctx_execute/);
  // Every deny names the escape hatch and forbids a Bash retry.
  for (const r of [fetch, batch, pipe]) {
    assert.match(r?.hookSpecificOutput?.permissionDecisionReason ?? "", /steer_enabled/);
    assert.match(r?.hookSpecificOutput?.permissionDecisionReason ?? "", /[Dd]o not retry/);
    assert.equal("updatedInput" in (r?.hookSpecificOutput ?? {}), false);
  }
});

test("buildWebFetchDeny: deny with the namespaced tool, the URL, the hostname source and the escape hatch", () => {
  const r = buildWebFetchDeny("https://docs.example.org/page?q=1");
  assert.equal(r.hookSpecificOutput?.permissionDecision, "deny");
  const reason = r.hookSpecificOutput?.permissionDecisionReason ?? "";
  assert.match(reason, /mcp__plugin_linux-token-efficiency_context-mode__ctx_fetch_and_index/);
  assert.match(reason, /"url": "https:\/\/docs\.example\.org\/page\?q=1"/);
  assert.match(reason, /"source": "docs\.example\.org"/);
  assert.match(reason, /Do not retry WebFetch/);
  assert.match(reason, /steer_enabled/);
  assert.equal(buildWebFetchDeny("not a url").hookSpecificOutput?.permissionDecisionReason?.includes('"source": "web"'), true);
});
