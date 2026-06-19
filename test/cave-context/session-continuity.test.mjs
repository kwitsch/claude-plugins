import { test } from "node:test";
import assert from "node:assert/strict";
import { extractContinuity } from "../../plugins/cave-context/mcp/session-continuity.mjs";
import { sessionStartPrompt } from "../../plugins/cave-context/mcp/sessionprompt.mjs";

const ROUTING = "<ctx_routing>Route big output through ctx_* tools.</ctx_routing>";

test("extracts the session_knowledge directive, dropping the routing block", () => {
  const ac = ROUTING + '\n\n<session_knowledge source="compact">\n<session_guide>\n## Last Request\nx\n</session_guide>\n</session_knowledge>';
  const out = extractContinuity(ac);
  assert.match(out, /^<session_knowledge source="compact">/);
  assert.match(out, /<\/session_knowledge>$/);
  assert.ok(!out.includes("ctx_routing"));
});

test("extracts the snapshot-fallback markdown, dropping the routing block", () => {
  const ac = ROUTING + "\n\n# Session Resume\n\nEvents: 12\n\n## Active Files\n- a.mjs";
  const out = extractContinuity(ac);
  assert.match(out, /^# Session Resume/);
  assert.ok(!out.includes("ctx_routing"));
});

test("returns null when only a routing block is present (fresh startup)", () => {
  assert.equal(extractContinuity(ROUTING), null);
});

test("returns null for empty / nullish input", () => {
  assert.equal(extractContinuity(""), null);
  assert.equal(extractContinuity(null), null);
  assert.equal(extractContinuity(undefined), null);
});

test("picks the earliest marker when both appear", () => {
  const ac = ROUTING + '\n# Session Resume\nsnap\n<session_knowledge source="continue">k</session_knowledge>';
  assert.match(extractContinuity(ac), /^# Session Resume/);
});

test("extractContinuity strips routing table and coexistence section", () => {
  // Feed extractContinuity an upstream-shaped payload: sessionStartPrompt() as the
  // routing prefix (simulating context-mode's routing block), followed by a continuity
  // tail. Confirms the new routing table rows (ctx_fetch_and_index, | native) do not
  // leak into the stripped continuity result.
  const ac = sessionStartPrompt() + '\n\n<session_knowledge source="compact">resume payload</session_knowledge>';
  const stripped = extractContinuity(ac);
  assert.doesNotMatch(stripped, /ctx_fetch_and_index/);
  assert.doesNotMatch(stripped, /\| native/);
  assert.match(stripped, /resume payload/);   // tail survives — keeps assertion load-bearing
});
