import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACT = path.join(REPO_ROOT, "plugins", "universal-format", "mcp", "server.mjs");
// server.ts reads this at startup from the manifest next to mcp/ -- no build-time inlining to go stale.
const PLUGIN_VERSION = JSON.parse(readFileSync(path.join(REPO_ROOT, "plugins", "universal-format", ".claude-plugin", "plugin.json"), "utf8")).version;

const SERVER_EXIT_TIMEOUT_MS = 30000; // normal run takes ~0.6s

// Spawn the built server under `runtime`, close stdin so readline hits EOF and the server exits
// on its own (rl.on("close", () => process.exit(0))), then collect stdout + stderr.
/** @param {string} runtime @returns {Promise<{stdout: string, stderr: string, code: number|null}>} */
function runServer(runtime) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime, [ARTIFACT], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (/** @type {Buffer} */ d) => (stdout += d.toString()));
    child.stderr.on("data", (/** @type {Buffer} */ d) => (stderr += d.toString()));
    // A server that ignores stdin EOF would otherwise hang until the CI job limit (seen once on CI).
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`server did not exit within ${SERVER_EXIT_TIMEOUT_MS}ms of stdin EOF; stderr: ${JSON.stringify(stderr)}`));
    }, SERVER_EXIT_TIMEOUT_MS);
    child.on("error", (/** @type {Error} */ e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (/** @type {number | null} */ code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.stdin.end(); // EOF -> readline "close" -> process.exit(0)
  });
}

test("built server logs `running under node` on stderr under node, keeps stdout JSON-RPC-only", async () => {
  const { stdout, stderr } = await runServer(process.execPath);
  assert.ok(stderr.includes(`running under node (v${PLUGIN_VERSION})`), `stderr must identify the node runtime and plugin.json's version; got: ${JSON.stringify(stderr)}`);
  // stdout is reserved for newline-delimited JSON-RPC 2.0: every non-empty line must parse as JSON.
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    assert.doesNotThrow(() => JSON.parse(line), `stdout carried a non-JSON-RPC line: ${line}`);
  }
});

// Claude Code stops a stdio MCP server with SIGINT (SIGTERM, then SIGKILL, if it lingers) on every
// platform but Windows, never by closing stdin. Node writes its V8 compile cache only on a normal
// exit, so each signal must end in process.exit(0), not in death by signal.
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  test(`built server exits 0 on ${signal}`, async () => {
    const child = spawn(process.execPath, [ARTIFACT], { stdio: ["pipe", "ignore", "pipe"] });
    try {
      await once(child.stderr, "data", { signal: AbortSignal.timeout(SERVER_EXIT_TIMEOUT_MS) }); // the startup line, written after the handlers are armed
      child.kill(signal);
      const [code, killedBy] = await once(child, "close", { signal: AbortSignal.timeout(SERVER_EXIT_TIMEOUT_MS) });
      assert.deepEqual([code, killedBy], [0, null], `${signal} must end in a normal exit(0)`);
    } finally {
      child.kill("SIGKILL");
    }
  });
}
