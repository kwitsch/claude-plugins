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
  assert.ok(tools.every((t) => t.name && t.inputSchema?.type === "object"), "tools expose a JSON-Schema inputSchema (type: object), not a raw Zod object");
  // Rich SDK-converted schema, not the permissive fallback (which also passes the check above).
  const search = tools.find((t) => t.name === "ctx_search");
  assert.ok(search.inputSchema.properties?.queries, "ctx_search retains the rich SDK-converted schema, not the permissive fallback");
  await up.callTool("ctx_index", { content: "embed alpha beta", source: "embed-test" });
  const r = await up.callTool("ctx_search", { queries: ["alpha"] });
  assert.match(JSON.stringify(r), /alpha/, "search returns indexed content");
  up.stop();
});
