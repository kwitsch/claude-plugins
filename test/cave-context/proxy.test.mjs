import { test } from "node:test";
import assert from "node:assert/strict";
import { Upstream } from "../../plugins/cave-context/mcp/proxy.mjs";

const FAKE = JSON.stringify(["node", new URL("./fake-upstream.mjs", import.meta.url).pathname]);

test("start lists upstream tools; callTool forwards", async () => {
  process.env.CAVE_CONTEXT_UPSTREAM_CMD = FAKE;
  const up = new Upstream();
  try {
    const tools = await up.start();
    assert.ok(tools.find((t) => t.name === "ctx_echo"));
    const res = await up.callTool("ctx_echo", { a: 1 });
    assert.match(JSON.stringify(res), /echo:\{\\\"a\\\":1\}/);
  } finally { up.stop(); delete process.env.CAVE_CONTEXT_UPSTREAM_CMD; }
});

test("after the child crashes, callTool fails fast and a fresh start re-spawns", async () => {
  process.env.CAVE_CONTEXT_UPSTREAM_CMD = FAKE;
  const up = new Upstream();
  try {
    await up.start();
    assert.equal(up.alive, true);
    // Sentinel tool makes the fake upstream exit; wait for the exit handler to mark it dead.
    await assert.rejects(up.callTool("ctx_crash", {}), /upstream exited/);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(up.alive, false);
    // Fail fast (reject, not hang) while dead — no waiting out the tool timeout.
    await assert.rejects(up.callTool("ctx_echo", { a: 1 }), /upstream not running/);
    // Re-spawn recovers the session.
    const tools = await up.start();
    assert.ok(tools.find((t) => t.name === "ctx_echo"));
    assert.equal(up.alive, true);
    const res = await up.callTool("ctx_echo", { a: 2 });
    assert.match(JSON.stringify(res), /echo:\{\\\"a\\\":2\}/);
  } finally { up.stop(); delete process.env.CAVE_CONTEXT_UPSTREAM_CMD; }
});
