import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const SERVER = new URL("../../plugins/cave-context/mcp/server.mjs", import.meta.url).pathname;
const FAKE = JSON.stringify(["node", new URL("./fake-upstream.mjs", import.meta.url).pathname]);

function rpc(proc, msgs) {
  return new Promise((resolve) => {
    const got = []; let buf = "";
    proc.stdout.on("data", (d) => {
      buf += d;
      let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) got.push(JSON.parse(l)); }
      if (got.length >= msgs.filter((m) => m.id != null).length) resolve(got);
    });
    for (const m of msgs) proc.stdin.write(JSON.stringify(m) + "\n");
  });
}

test("server lists proxied + hook tools and routes calls", async () => {
  const proc = spawn("node", [SERVER], { env: { ...process.env, CAVE_CONTEXT_UPSTREAM_CMD: FAKE, CAVE_CONTEXT_NO_UPSTREAM: "1" }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const out = await rpc(proc, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ctx_echo", arguments: { a: 1 } } },
    ]);
    const list = out.find((m) => m.id === 2).result.tools.map((t) => t.name);
    assert.ok(list.includes("ctx_echo"));
    assert.ok(list.includes("hook_userpromptsubmit"));
    assert.match(JSON.stringify(out.find((m) => m.id === 3).result), /echo:\{/);
  } finally { proc.kill(); }
});
