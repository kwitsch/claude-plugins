import { test } from "node:test";
import assert from "node:assert/strict";
import { reminderText } from "../../plugins/cave-context/mcp/caveman.mjs";

// cave-context's caveman mode is fixed at the "full" level: no level switching,
// no off switch, no userConfig, no runtime state. caveman.mjs is now just one text
// builder — reminderText() (the per-turn UserPromptSubmit reminder). The SessionStart
// ruleset lives statically in hooks/SessionStart.md.

test("reminderText is fixed at full", () => {
  const r = reminderText();
  assert.match(r, /^CAVE-CONTEXT: Drop articles/);
  assert.doesNotMatch(r, /MODE ACTIVE/);   // "MODE ACTIVE (full)." dropped from the reminder
  assert.match(r, /ctx_\*/);                         // routing nudge aligned with SessionStart
  assert.match(r, /write normal/i);                  // boundary wording matches the ruleset
});
