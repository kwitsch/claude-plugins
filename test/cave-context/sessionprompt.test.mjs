import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionStartPrompt } from "../../plugins/cave-context/mcp/sessionprompt.mjs";

test("contains caveman ruleset and routing guidance", () => {
  const p = sessionStartPrompt();
  assert.match(p, /CAVE-CONTEXT MODE ACTIVE/);
  // Assert each tool name separately — an OR would pass if only one were present.
  assert.match(p, /ctx_search/);
  assert.match(p, /ctx_execute/);
  assert.match(p, /ctx_batch_execute/);
  // Routing TABLE (directive) — the per-tool redirects must be present.
  assert.match(p, /ctx_execute_file/);
  assert.match(p, /ctx_fetch_and_index/);
  assert.match(p, /WebFetch/);
  assert.match(p, /Think-in-code/i);
  assert.match(p, /\| native/);                       // routing table present (matches a data row in the tool-routing table)
  assert.doesNotMatch(p, /Coexistence/i);             // coexistence block removed from the SessionStart prompt
});
