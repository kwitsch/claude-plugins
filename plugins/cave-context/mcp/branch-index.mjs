// branch-index.mjs — observe the git branch on PostToolUse and re-index the working
// directory via the upstream ctx_index when it changes. Imported (NOT spawned) by
// server.mjs → no executable bit (like compress.mjs). Pure logic + injected deps for
// testability; the default git detector is added alongside parseGitInfo (see below).
import { basename } from "node:path";
import { spawn } from "node:child_process";

// Track the branch per repo root; re-index via callTool("ctx_index", …) on change.
// Returns { note(cwd) } — call it fire-and-forget (unawaited) on PostToolUse. `note`
// never throws and never rejects.
/**
 * @param {{
 *   detectBranch?: (cwd: string, timeoutMs?: number) => Promise<GitInfo|null>,
 *   ensureUp?: () => Promise<any[]>,
 *   callTool?: (name: string, args: Record<string, any>) => Promise<any>,
 *   indexOpts?: { maxDepth?: number, maxFiles?: number }
 * }} [opts]
 * @returns {{ note: (cwd: string) => Promise<void> }}
 */
export function createBranchIndexer({ detectBranch = detectBranchViaGit, ensureUp, callTool, indexOpts = {} } = {}) {
  const maxDepth = indexOpts.maxDepth ?? 5;
  const maxFiles = indexOpts.maxFiles ?? 200;
  const lastBranch = new Map();    // root -> branchId (last SUCCESSFULLY indexed)
  const inflightCwds = new Set();  // cheap pre-await dedup (same cwd)
  const inflightRoots = new Set(); // authoritative single-flight guard (per repo root)

  // Observe one PostToolUse cwd: detect the git branch and, if it changed, re-index via ctx_index; never throws.
  /**
   * @param {string} cwd
   * @returns {Promise<void>}
   */
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
        if (!ensureUp || !callTool) return;            // no upstream injected (tests without DI)
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

// Parse `git -C <cwd> rev-parse --show-toplevel HEAD --abbrev-ref HEAD` stdout —
// three lines [toplevel, fullSha, abbrevRef] — into { root, branch } | null.
// Detached HEAD → abbrevRef === "HEAD" → use the short sha. Slash branch kept whole.
/**
 * @param {string} stdout
 * @returns {GitInfo|null}
 */
export function parseGitInfo(stdout) {
  if (typeof stdout !== "string") return null;
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;
  const [toplevel, fullSha, abbrevRef] = lines;
  const branch = abbrevRef === "HEAD" ? fullSha.slice(0, 12) : abbrevRef;
  if (!toplevel || !branch) return null;
  return { root: toplevel, branch };
}

// Default branch detector: one git spawn, parsed by parseGitInfo. Resolves
// { root, branch } | null; never rejects (any error → null), so callers need no catch.
/**
 * @param {string} cwd
 * @param {number} [timeoutMs]
 * @returns {Promise<GitInfo|null>}
 */
export function detectBranchViaGit(cwd, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("git", ["-C", cwd, "rev-parse", "--show-toplevel", "HEAD", "--abbrev-ref", "HEAD"],
        { stdio: ["ignore", "pipe", "ignore"] });
    } catch { return resolve(null); }
    let out = ""; let done = false;
    /** @param {GitInfo|null} v */
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } finish(null); }, timeoutMs);
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.stdout.on("data", /** @param {Buffer} d */ (d) => { out += d; });
    child.on("close", /** @param {number|null} code */ (code) => { clearTimeout(timer); finish(code === 0 ? parseGitInfo(out) : null); });
  });
}
