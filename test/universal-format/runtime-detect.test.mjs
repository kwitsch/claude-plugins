import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACT = path.join(REPO_ROOT, "plugins", "universal-format", "mcp", "server.mjs");

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
  assert.ok(stderr.includes("running under node"), `stderr must identify the node runtime; got: ${JSON.stringify(stderr)}`);
  // stdout is reserved for newline-delimited JSON-RPC 2.0: every non-empty line must parse as JSON.
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    assert.doesNotThrow(() => JSON.parse(line), `stdout carried a non-JSON-RPC line: ${line}`);
  }
});
