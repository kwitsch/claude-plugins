import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveBase } from "../../plugins/universal-format/mcp/server.mjs";

// resolveBase replaced the old relativeInCwd gate: cwd is a HINT (preferred when it really
// contains the file, so every in-cwd behavior is byte-identical to before), never a gate. These
// tests assume no `.git` entry exists above os.tmpdir(), which holds on CI and on a normal box.

/** @param {string} prefix @returns {string} */
function tmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** The invariant every downstream consumer relies on: `base` is an ancestor-or-equal directory of
 * the file, so `path.relative(base, resolved)` never escapes with `..` (isExcludedPath keeps the
 * shape it was written for) and both bounded upward walks terminate at `base`.
 * @param {string} base @param {string} resolved @returns {void} */
function assertAncestor(base, resolved) {
  const rel = path.relative(base, resolved);
  assert.ok(!path.isAbsolute(rel), `${base} must be an ancestor-or-equal of ${resolved} (rel=${rel})`);
  assert.ok(!rel.split(path.sep).includes(".."), `${base} must be an ancestor-or-equal of ${resolved} (rel=${rel})`);
}

test("resolveBase: a file inside cwd anchors at cwd (nested, direct, and trailing-separator cwd)", () => {
  const cwd = tmp("uf-rb-in-");
  mkdirSync(path.join(cwd, "src"));
  const nested = path.join(cwd, "src", "a.json");
  const direct = path.join(cwd, "a.json");
  assert.equal(resolveBase(cwd, nested), cwd);
  assert.equal(resolveBase(cwd, direct), cwd);
  assert.equal(resolveBase(cwd + path.sep, nested), cwd + path.sep, "a trailing-separator cwd must still contain its own files");
  assertAncestor(resolveBase(cwd, nested), nested);
});

test("resolveBase: cwd wins over a nested git repo inside it", () => {
  const cwd = tmp("uf-rb-nested-");
  const inner = path.join(cwd, "inner");
  mkdirSync(path.join(inner, ".git"), { recursive: true });
  const fp = path.join(inner, "a.json");
  assert.equal(resolveBase(cwd, fp), cwd, "cwd is preferred whenever it contains the file");
});

test("resolveBase: an out-of-cwd file anchors at its own git root (.git directory)", () => {
  const cwd = tmp("uf-rb-cwd-");
  const proj = tmp("uf-rb-proj-");
  mkdirSync(path.join(proj, ".git"));
  mkdirSync(path.join(proj, "src"));
  const fp = path.join(proj, "src", "a.json");
  assert.equal(resolveBase(cwd, fp), proj);
  assertAncestor(resolveBase(cwd, fp), fp);
});

test("resolveBase: a .git FILE (worktree/submodule shape) is a project root too", () => {
  const cwd = tmp("uf-rb-cwd2-");
  const proj = tmp("uf-rb-wt-");
  writeFileSync(path.join(proj, ".git"), "gitdir: /elsewhere/.git/worktrees/wt\n");
  mkdirSync(path.join(proj, "src"));
  const fp = path.join(proj, "src", "a.json");
  assert.equal(resolveBase(cwd, fp), proj, ".git is existence-checked, never isDirectory()-checked");
});

test("resolveBase: an out-of-cwd file with no .git ancestor anchors at its own directory", () => {
  const cwd = tmp("uf-rb-cwd3-");
  const orphan = tmp("uf-rb-orphan-");
  const fp = path.join(orphan, "a.json");
  assert.equal(resolveBase(cwd, fp), orphan);
  assertAncestor(resolveBase(cwd, fp), fp);
});

test("resolveBase: an empty cwd falls straight through to the git root, else the file's directory", () => {
  const proj = tmp("uf-rb-empty-proj-");
  mkdirSync(path.join(proj, ".git"));
  mkdirSync(path.join(proj, "src"));
  const inProj = path.join(proj, "src", "a.json");
  assert.equal(resolveBase("", inProj), proj);

  const orphan = tmp("uf-rb-empty-orphan-");
  const loose = path.join(orphan, "a.json");
  assert.equal(resolveBase("", loose), orphan);
  assertAncestor(resolveBase("", loose), loose);
});

test("resolveBase: the git-root walk stops AT $HOME, so a dotfiles repo there is never used as an anchor", () => {
  const originalHome = process.env.HOME;
  const fakeHome = tmp("uf-rb-home-");
  mkdirSync(path.join(fakeHome, ".git")); // simulates a git-tracked dotfiles checkout at $HOME
  process.env.HOME = fakeHome;
  try {
    const scratch = path.join(fakeHome, "scratch-notes");
    mkdirSync(scratch);
    const fp = path.join(scratch, "a.json");
    assert.equal(resolveBase("", fp), scratch, "must fall back to the file's own directory, never treat $HOME's dotfiles repo as the project");
  } finally {
    process.env.HOME = originalHome;
  }
});

test("resolveBase: a real project nested inside $HOME still resolves to its own nearer git root", () => {
  const originalHome = process.env.HOME;
  const fakeHome = tmp("uf-rb-home2-");
  mkdirSync(path.join(fakeHome, ".git")); // dotfiles repo at $HOME -- must not win over the nearer project
  process.env.HOME = fakeHome;
  try {
    const proj = path.join(fakeHome, "repos", "myproject");
    mkdirSync(path.join(proj, ".git"), { recursive: true });
    const fp = path.join(proj, "a.json");
    assert.equal(resolveBase("", fp), proj, "the nearer project root wins over $HOME's dotfiles repo");
  } finally {
    process.env.HOME = originalHome;
  }
});

test("resolveBase: the out-of-cwd git-root walk is memoized per file directory", () => {
  const parent = tmp("uf-rb-memo-parent-");
  const fileDir = path.join(parent, "sub");
  mkdirSync(fileDir);
  const fp = path.join(fileDir, "a.json");
  assert.equal(resolveBase("", fp), fileDir, "no .git ancestor yet -> falls back to the file's own directory");
  mkdirSync(path.join(parent, ".git")); // a fresh walk would now find this ancestor
  assert.equal(resolveBase("", fp), fileDir, "the earlier miss stays cached -- a later git init at an ancestor is not picked up (documented, accepted trade-off)");
});
