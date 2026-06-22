import { test } from "node:test";
import assert from "node:assert/strict";
import { createBranchIndexer, parseGitInfo, detectBranchViaGit } from "../../plugins/cave-context/mcp/branch-index.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

// Build a tracker with controllable fake deps; `calls` records every callTool().
function makeDeps(overrides = {}) {
  const calls = [];
  const deps = {
    detectBranch: overrides.detectBranch ?? (async () => ({ root: "/repo", branch: "main" })),
    ensureUp: overrides.ensureUp ?? (async () => [{ name: "ctx_index" }]),
    callTool: overrides.callTool ?? (async (name, args) => { calls.push({ name, args }); return {}; }),
  };
  if (overrides.indexOpts) deps.indexOpts = overrides.indexOpts;
  return { calls, deps };
}

test("first note on a new root indexes (startup = change)", async () => {
  const { calls, deps } = makeDeps();
  const { note } = createBranchIndexer(deps);
  await note("/repo");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "ctx_index");
  assert.deepEqual(calls[0].args, { path: "/repo", source: "project:repo", maxDepth: 5, maxFiles: 200 });
});

test("second note with the same branch does not re-index", async () => {
  const { calls, deps } = makeDeps();
  const { note } = createBranchIndexer(deps);
  await note("/repo");
  await note("/repo");
  assert.equal(calls.length, 1);
});

test("a branch change triggers a re-index", async () => {
  let branch = "main";
  const { calls, deps } = makeDeps({ detectBranch: async () => ({ root: "/repo", branch }) });
  const { note } = createBranchIndexer(deps);
  await note("/repo");
  branch = "feature/x";
  await note("/repo");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.source, "project:repo");
});

test("single-flight: same cwd while indexing → no second dispatch", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { calls, deps } = makeDeps({
    callTool: async (name, args) => { calls.push({ name, args }); await gate; return {}; },
  });
  const { note } = createBranchIndexer(deps);
  const p1 = note("/repo");   // enters, hangs in callTool on `gate`
  const p2 = note("/repo");   // inflightCwds blocks immediately
  await p2;
  release();
  await p1;
  assert.equal(calls.length, 1);
});

test("single-flight: different cwd, same root → only one dispatch", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { calls, deps } = makeDeps({
    detectBranch: async () => ({ root: "/repo", branch: "main" }), // both cwds map to /repo
    callTool: async (name, args) => { calls.push({ name, args }); await gate; return {}; },
  });
  const { note } = createBranchIndexer(deps);
  const p1 = note("/repo/sub-a");
  const p2 = note("/repo/sub-b");
  await p2;          // p2: distinct cwd, but inflightRoots blocks it once the root is known
  release();
  await p1;
  assert.equal(calls.length, 1);
});

test("upstream unavailable → no index; retries once up", async () => {
  let up = false;
  const { calls, deps } = makeDeps({ ensureUp: async () => (up ? [{ name: "ctx_index" }] : []) });
  const { note } = createBranchIndexer(deps);
  await note("/repo");
  assert.equal(calls.length, 0);
  up = true;
  await note("/repo");
  assert.equal(calls.length, 1);
});

test("callTool rejection is swallowed; branch not committed; retries", async () => {
  let fail = true;
  const { calls, deps } = makeDeps({
    callTool: async (name, args) => { calls.push({ name, args }); if (fail) throw new Error("boom"); return {}; },
  });
  const { note } = createBranchIndexer(deps);
  await note("/repo");          // throws internally → swallowed, branch NOT committed
  assert.equal(calls.length, 1);
  fail = false;
  await note("/repo");          // retries because the branch was never committed
  assert.equal(calls.length, 2);
});

test("toggle: CAVE_CONTEXT_BRANCH_REINDEX=false makes note a no-op", async () => {
  const { calls, deps } = makeDeps();
  const { note } = createBranchIndexer(deps);
  const prior = process.env.CAVE_CONTEXT_BRANCH_REINDEX;
  process.env.CAVE_CONTEXT_BRANCH_REINDEX = "false";
  try { await note("/repo"); }
  finally {
    if (prior === undefined) delete process.env.CAVE_CONTEXT_BRANCH_REINDEX;
    else process.env.CAVE_CONTEXT_BRANCH_REINDEX = prior;
  }
  assert.equal(calls.length, 0);
});

test("non-git cwd (detectBranch → null) → no dispatch, no throw", async () => {
  const { calls, deps } = makeDeps({ detectBranch: async () => null });
  const { note } = createBranchIndexer(deps);
  await note("/not/a/repo");
  assert.equal(calls.length, 0);
});

test("note ignores a falsy cwd", async () => {
  const { calls, deps } = makeDeps();
  const { note } = createBranchIndexer(deps);
  await note("");
  await note(undefined);
  assert.equal(calls.length, 0);
});

test("parseGitInfo: slash branch kept whole", () => {
  const out = "/repo/root\nc7015d471809be3ab01ad1d8be5344583a68b47e\nfeature/cave-context-x\n";
  assert.deepEqual(parseGitInfo(out), { root: "/repo/root", branch: "feature/cave-context-x" });
});

test("parseGitInfo: detached HEAD uses the short sha", () => {
  const out = "/repo/root\nc7015d471809be3ab01ad1d8be5344583a68b47e\nHEAD\n";
  assert.deepEqual(parseGitInfo(out), { root: "/repo/root", branch: "c7015d471809" });
});

test("parseGitInfo: too few lines / non-string → null", () => {
  assert.equal(parseGitInfo("one-line-only\n"), null);
  assert.equal(parseGitInfo(""), null);
  assert.equal(parseGitInfo(null), null);
});

// Hermetic temp git repo on branch <branch>. gpgsign disabled to avoid signing prompts.
function makeRepo(branch) {
  const dir = mkdtempSync(join(tmpdir(), "cc-bi-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: ["ignore", "ignore", "ignore"] });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "f.txt"), "x");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("checkout", "-q", "-b", branch);
  return dir;
}

test("detectBranchViaGit: real repo with a slash branch", async () => {
  const dir = makeRepo("feature/abc");
  try {
    const info = await detectBranchViaGit(dir);
    assert.ok(info, "info is non-null in a git repo");
    assert.equal(info.branch, "feature/abc");
    assert.equal(basename(info.root), basename(dir)); // symlink-resolution-safe comparison
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("detectBranchViaGit: non-git directory → null", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-bi-nogit-"));
  try { assert.equal(await detectBranchViaGit(dir), null); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
