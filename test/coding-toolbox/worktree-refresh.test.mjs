// worktree refresh (tool.call on EnterWorktree, after the tool ran) — the pure logic in
// plugins/coding-toolbox/hooks/policy.mjs, driven with real git against hermetic fixture
// repos (a bare file-path origin, no network). Hook wiring (the note reaching the model as
// context, the toggle, the switch-into-existing skip) is covered by plugins/coding-toolbox/tests/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { isWorktreeRefreshEnabled, refreshWorktree } from "../../plugins/coding-toolbox/hooks/policy.mjs";

// Isolated from the host's git config (HOME, system config) like the bats suite's common_setup.
const ENV = { ...process.env, HOME: mkdtempSync(path.join(os.tmpdir(), "ct-home-")), GIT_CONFIG_NOSYSTEM: "1" };

/** @param {string} cwd @param {string[]} args */
function run(cwd, args) {
  const r = spawnSync("git", args, { cwd, env: ENV, encoding: "utf8" });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** @param {string} cwd @param {...string} args */
function git(cwd, ...args) {
  const r = run(cwd, args);
  assert.equal(r.exitCode, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** child_process stand-in for the mod's $.process / $.fs-backed io; records every git call. */
function makeIo() {
  /** @type {string[][]} */
  const calls = [];
  return {
    calls,
    /** @param {string} cwd @param {string[]} args */
    git: async (cwd, args) => {
      calls.push(args);
      return run(cwd, args);
    },
    /** @param {string} p */
    realPath: async (p) => realpathSync(p),
  };
}

/** A bare origin, a checkout clone on main, and a linked worktree at the same tip. */
function fixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), "ct-git-"));
  const origin = path.join(base, "origin.git");
  const checkout = path.join(base, "checkout");
  const wt = path.join(base, "wt");
  git(base, "init", "--bare", "-q", origin);
  git(base, "init", "-q", "-b", "main", checkout);
  git(checkout, "config", "user.email", "test@example.com");
  git(checkout, "config", "user.name", "test");
  writeFileSync(path.join(checkout, "file.txt"), "hello\n");
  git(checkout, "add", "file.txt");
  git(checkout, "commit", "-q", "-m", "initial");
  git(checkout, "remote", "add", "origin", origin);
  git(checkout, "push", "-q", "origin", "main");
  if (run(checkout, ["remote", "set-head", "origin", "-a"]).exitCode !== 0) {
    git(checkout, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  }
  git(checkout, "worktree", "add", "-q", "-b", "wt-branch", wt, "main");
  return { origin, checkout, wt };
}

/** Upstream moves on after the worktree was made. @param {string} checkout */
function advanceUpstream(checkout) {
  appendFileSync(path.join(checkout, "file.txt"), "more\n");
  git(checkout, "commit", "-q", "-am", "upstream advance");
  git(checkout, "push", "-q", "origin", "main");
}

test("fetches and rebases a new worktree onto origin's default branch, silently", async () => {
  const { checkout, wt } = fixture();
  advanceUpstream(checkout);
  assert.equal(await refreshWorktree(wt, makeIo()), undefined);
  assert.equal(git(wt, "log", "-1", "--format=%s"), "upstream advance");
});

test("skips when the target is not a linked worktree", async () => {
  const { checkout } = fixture();
  git(checkout, "remote", "set-url", "origin", "/nonexistent/path");
  const io = makeIo();
  assert.equal(await refreshWorktree(checkout, io), undefined);
  assert.ok(!io.calls.some((a) => a[0] === "fetch"));
});

test("skips outside any git repository", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ct-nogit-"));
  assert.equal(await refreshWorktree(dir, makeIo()), undefined);
});

// Regression guard for the abs-vs-relative hazard fresh-branch's detection hit (commit
// 23328db): from a subdirectory --git-dir is absolute while --git-common-dir is relative to
// the TARGET cwd; resolving it anywhere else makes a main checkout look like a worktree.
test("resolves a relative --git-common-dir against the target cwd", async () => {
  const { checkout, wt } = fixture();
  mkdirSync(path.join(checkout, "sub"));
  writeFileSync(path.join(wt, "file.txt"), "worktree change\n");
  git(wt, "commit", "-q", "-am", "worktree advance");
  git(wt, "push", "-q", "origin", "wt-branch:main");
  assert.equal(await refreshWorktree(path.join(checkout, "sub"), makeIo()), undefined);
  assert.equal(git(checkout, "log", "-1", "--format=%s"), "initial");
});

test("aborts and reports a rebase conflict with git's own diagnostic", async () => {
  const { checkout, wt } = fixture();
  writeFileSync(path.join(wt, "file.txt"), "worktree change\n");
  git(wt, "commit", "-q", "-am", "worktree-local edit");
  writeFileSync(path.join(checkout, "file.txt"), "upstream change\n");
  git(checkout, "commit", "-q", "-am", "upstream conflicting edit");
  git(checkout, "push", "-q", "origin", "main");
  const note = await refreshWorktree(wt, makeIo());
  assert.match(note ?? "", /^worktree-refresh: rebase onto origin\/main conflicted and was aborted/);
  assert.match(note ?? "", /could not apply/);
  const gitDir = path.resolve(wt, git(wt, "rev-parse", "--git-dir"));
  assert.ok(!existsSync(path.join(gitDir, "rebase-merge")));
  assert.ok(!existsSync(path.join(gitDir, "rebase-apply")));
});

test("reports a failed fetch", async () => {
  const { wt } = fixture();
  git(wt, "remote", "set-url", "origin", "/nonexistent/path");
  const note = await refreshWorktree(wt, makeIo());
  // set-head and `remote show` fail too, but the cached origin/HEAD still names main
  assert.match(note ?? "", /^worktree-refresh: fetch of origin\/main failed — this worktree may not have the latest upstream changes \(.+\)$/);
});

test("a rejected git call (timeout) surfaces through the same report path", async () => {
  const { wt } = fixture();
  const io = makeIo();
  const hanging = {
    ...io,
    /** @param {string} cwd @param {string[]} args */
    git: async (cwd, args) => {
      if (args[0] === "fetch") throw new Error("process timed out after 30000 ms");
      return io.git(cwd, args);
    },
  };
  assert.match((await refreshWorktree(wt, hanging)) ?? "", /fetch of origin\/main failed .*\(process timed out after 30000 ms\)$/);
});

test("toggle is fail-open: only a literal false disables", () => {
  assert.equal(isWorktreeRefreshEnabled(false), false);
  assert.equal(isWorktreeRefreshEnabled("false"), false);
  for (const v of [true, "true", undefined, "", "${user_config.worktree_refresh}"]) {
    assert.equal(isWorktreeRefreshEnabled(v), true, String(v));
  }
});
