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
  assert.match(p, /uninstall caveman and context-mode/i);
});
