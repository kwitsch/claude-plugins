import { test } from "node:test";
import assert from "node:assert/strict";
import { createBranchIndexer } from "../../plugins/cave-context/mcp/branch-index.mjs";

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
