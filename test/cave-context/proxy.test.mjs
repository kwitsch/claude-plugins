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
