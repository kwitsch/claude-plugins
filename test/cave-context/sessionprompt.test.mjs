import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionStartPrompt } from "../../plugins/cave-context/mcp/sessionprompt.mjs";

test("contains caveman ruleset, routing guidance, coexistence warning", () => {
  const p = sessionStartPrompt();
  assert.match(p, /CAVE-CONTEXT MODE ACTIVE/);
  assert.match(p, /level: full/);
  // Assert each tool name separately — an OR would pass if only one were present.
  assert.match(p, /ctx_search/);
  assert.match(p, /ctx_execute/);
  assert.match(p, /ctx_batch_execute/);
  assert.match(p, /uninstall both/i);
  // Routing TABLE (directive) — the per-tool redirects must be present.
  assert.match(p, /ctx_execute_file/);
  assert.match(p, /ctx_fetch_and_index/);
  assert.match(p, /WebFetch/);
  assert.match(p, /Think-in-code/i);
  assert.match(p, /\| native/);                       // routing table present (matches a data row in the tool-routing table)
});
