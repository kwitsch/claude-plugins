import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionStartPrompt } from "../../plugins/cave-context/mcp/sessionprompt.mjs";

test("contains caveman ruleset, routing guidance, coexistence warning", () => {
  const p = sessionStartPrompt();
  assert.match(p, /CAVE-CONTEXT MODE ACTIVE/);
  assert.match(p, /ctx_search|ctx_execute|ctx_batch_execute/);
  assert.match(p, /uninstall caveman and context-mode/i);
});
