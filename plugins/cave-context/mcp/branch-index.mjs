// branch-index.mjs — observe the git branch on PostToolUse and re-index the working
// directory via the upstream ctx_index when it changes. Imported (NOT spawned) by
// server.mjs → no executable bit (like compress.mjs). Pure logic + injected deps for
// testability; the default git detector is added alongside parseGitInfo (see below).
import { basename } from "node:path";

// Track the branch per repo root; re-index via callTool("ctx_index", …) on change.
// Returns { note(cwd) } — call it fire-and-forget (unawaited) on PostToolUse. `note`
// never throws and never rejects.
export function createBranchIndexer({ detectBranch, ensureUp, callTool, indexOpts = {} } = {}) {
  const maxDepth = indexOpts.maxDepth ?? 5;
  const maxFiles = indexOpts.maxFiles ?? 200;
  const lastBranch = new Map();    // root -> branchId (last SUCCESSFULLY indexed)
  const inflightCwds = new Set();  // cheap pre-await dedup (same cwd)
  const inflightRoots = new Set(); // authoritative single-flight guard (per repo root)

  async function note(cwd) {
    if (process.env.CAVE_CONTEXT_BRANCH_REINDEX === "false") return; // toggle (fail-open)
    if (!cwd || inflightCwds.has(cwd)) return;
    inflightCwds.add(cwd);
    try {
      let info = null;
      try { info = await detectBranch(cwd); } catch { info = null; }
      if (!info || !info.root || !info.branch) return; // not a git repo / detection failed
      const { root, branch } = info;
      if (inflightRoots.has(root)) return;             // root-level single-flight (atomic — no await since the check)
      inflightRoots.add(root);
      try {
        if (lastBranch.get(root) === branch) return;   // unchanged → no-op
        const tools = await ensureUp();                // "nach MCP upstream start"
        if (!tools || !tools.length) return;           // upstream down → retry next time (branch NOT committed)
        await callTool("ctx_index", { path: root, source: `project:${basename(root)}`, maxDepth, maxFiles });
        lastBranch.set(root, branch);                  // commit ONLY on success
      } catch { /* swallow — retry on the next PostToolUse */ }
      finally { inflightRoots.delete(root); }
    } finally {
      inflightCwds.delete(cwd);
    }
  }

  return { note };
}
