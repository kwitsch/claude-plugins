import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

const SERVER = new URL("../../plugins/cave-context/mcp/server.mjs", import.meta.url).pathname;

function makeRepo(branch, content = "hello world") {
  const dir = mkdtempSync(join(tmpdir(), "cc-srv-bi-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: ["ignore", "ignore", "ignore"] });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "f.txt"), content);
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("checkout", "-q", "-b", branch);
  return dir;
}

// Poll via RPC until ctx_search returns `token` in results, or timeout.
async function waitForIndexed(proc, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let id = 100;
  while (Date.now() < deadline) {
    const result = await new Promise((resolve) => {
      let buf = "";
      const reqId = id++;
      const onData = (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const l = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!l.trim()) continue;
          let msg; try { msg = JSON.parse(l); } catch { continue; }
          if (msg.id === reqId) { proc.stdout.removeListener("data", onData); resolve(msg); }
        }
      };
      proc.stdout.on("data", onData);
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: reqId, method: "tools/call", params: { name: "ctx_search", arguments: { queries: [token] } } }) + "\n");
    });
    const text = JSON.stringify(result?.result ?? "");
    if (text.includes(token)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test("PostToolUse with a git cwd triggers in-process ctx_index (fire-and-forget)", async () => {
  // Distinctive token that ctx_search can find after branch-indexer runs ctx_index.
  const TOKEN = "branchindex_sentinel_xyzzy42";
  const repo = makeRepo("feature/e2e", TOKEN);
  const dataDir = mkdtempSync(join(tmpdir(), "cc-data-"));
  // CAVE_CONTEXT_NO_UPSTREAM=1 makes the hook DELEGATE (context-mode CLI) a no-op (hermetic);
  // it does NOT affect the embedded MCP upstream (embed.mjs handles ctx_* in-process).
  const proc = spawn("node", [SERVER], {
    env: { ...process.env, CONTEXT_MODE_DIR: dataDir, CLAUDE_PROJECT_DIR: dataDir, CAVE_CONTEXT_NO_UPSTREAM: "1", CLAUDE_PLUGIN_DATA: dataDir },
    stdio: ["pipe", "pipe", "inherit"],
  });
  try {
    // Initialize + trigger PostToolUse from the repo dir (branch-indexer fires ctx_index fire-and-forget).
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n");
    // Drain the initialize response.
    await new Promise((resolve) => {
      let buf = "";
      const onData = (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const l = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!l.trim()) continue;
          let msg; try { msg = JSON.parse(l); } catch { continue; }
          if (msg.id === 1) { proc.stdout.removeListener("data", onData); resolve(msg); }
        }
      };
      proc.stdout.on("data", onData);
    });
    // Fire hook_posttooluse from the repo cwd — branch-indexer detects new branch and dispatches ctx_index.
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "hook_posttooluse", arguments: { hook_event_name: "PostToolUse", tool_name: "Bash", cwd: repo } } }) + "\n");
    // Drain the hook response.
    await new Promise((resolve) => {
      let buf = "";
      const onData = (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const l = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!l.trim()) continue;
          let msg; try { msg = JSON.parse(l); } catch { continue; }
          if (msg.id === 2) { proc.stdout.removeListener("data", onData); resolve(msg); }
        }
      };
      proc.stdout.on("data", onData);
    });
    // Poll ctx_search until the indexed content is visible (fire-and-forget may still be in flight).
    const found = await waitForIndexed(proc, TOKEN, 5000);
    assert.ok(found, `ctx_search found '${TOKEN}' after branch-indexer ran ctx_index`);
  } finally {
    proc.kill();
    rmSync(repo, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});
