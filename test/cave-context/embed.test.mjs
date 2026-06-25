import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("embedded Upstream lists ctx tools and round-trips index->search", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "embed-test-"));
  process.env.CONTEXT_MODE_DIR = scratch;
  process.env.CLAUDE_PROJECT_DIR = scratch;
  const { Upstream } = await import("../../plugins/cave-context/mcp/embed.mjs");
  const up = new Upstream();
  const tools = await up.start();
  assert.ok(up.alive, "alive after start");
  assert.ok(tools.some((t) => t.name === "ctx_search"), "ctx_search listed");
  assert.ok(tools.every((t) => t.name && t.inputSchema), "tools have name+inputSchema");
  await up.callTool("ctx_index", { content: "embed alpha beta", source: "embed-test" });
  const r = await up.callTool("ctx_search", { queries: ["alpha"] });
  assert.match(JSON.stringify(r), /alpha/, "search returns indexed content");
  up.stop();
});
