import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

const SERVER = new URL("../../plugins/cave-context/mcp/server.mjs", import.meta.url).pathname;
const FAKE_REC = JSON.stringify(["node", new URL("./fake-upstream-recording.mjs", import.meta.url).pathname]);

function makeRepo(branch) {
  const dir = mkdtempSync(join(tmpdir(), "cc-srv-bi-"));
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

// Poll a file until it has at least one line; return the first line parsed, or null on timeout.
async function waitForLine(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (existsSync(file)) {
        const txt = readFileSync(file, "utf-8").trim();
        if (txt) return JSON.parse(txt.split("\n")[0]);
      }
    } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

test("PostToolUse with a git cwd dispatches ctx_index to upstream (fire-and-forget)", async () => {
  const repo = makeRepo("feature/e2e");
  const rec = join(mkdtempSync(join(tmpdir(), "cc-rec-")), "calls.log");
  const dataDir = mkdtempSync(join(tmpdir(), "cc-data-"));
  // CAVE_CONTEXT_NO_UPSTREAM=1 makes the hook DELEGATE (context-mode CLI) a no-op (hermetic);
  // it does NOT affect the MCP upstream proxy, which uses CAVE_CONTEXT_UPSTREAM_CMD (the recorder).
  const proc = spawn("node", [SERVER], {
    env: { ...process.env, CAVE_CONTEXT_UPSTREAM_CMD: FAKE_REC, CAVE_CONTEXT_NO_UPSTREAM: "1", CC_REC_FILE: rec, CLAUDE_PLUGIN_DATA: dataDir },
    stdio: ["pipe", "pipe", "inherit"],
  });
  try {
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n");
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "hook_posttooluse", arguments: { hook_event_name: "PostToolUse", tool_name: "Bash", cwd: repo } } }) + "\n");
    const args = await waitForLine(rec, 5000);
    assert.ok(args, "ctx_index was dispatched to the upstream");
    assert.equal(basename(args.path), basename(repo));
    assert.equal(args.source, `project:${basename(repo)}`);
    assert.equal(args.maxDepth, 5);
    assert.equal(args.maxFiles, 200);
  } finally {
    proc.kill();
    rmSync(repo, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    try { rmSync(rec, { force: true }); } catch { /* ignore */ }
  }
});
