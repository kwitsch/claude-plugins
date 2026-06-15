import { test } from "node:test";
import assert from "node:assert/strict";
import { reminderText, rulesetText } from "../../plugins/cave-context/mcp/caveman.mjs";

// cave-context's caveman mode is fixed at the "full" level: no level switching,
// no off switch, no userConfig, no runtime state. caveman.mjs is now just the two
// text builders.

test("rulesetText is caveman:compress and fixed at full", () => {
  const r = rulesetText();
  assert.match(r, /CAVE-CONTEXT MODE ACTIVE/);
  assert.match(r, /level: full/);
  assert.match(r, /Drop: articles/);
});

test("rulesetText carries no level-switch / off-switch copy", () => {
  const r = rulesetText();
  assert.doesNotMatch(r, /Switch: \/caveman/);   // no lite|full|ultra switching
  assert.doesNotMatch(r, /stop caveman/i);        // no off switch
  assert.doesNotMatch(r, /normal mode/i);
});

test("reminderText is fixed at full", () => {
  const r = reminderText();
  assert.match(r, /^CAVE-CONTEXT: Drop articles/);
  assert.doesNotMatch(r, /MODE ACTIVE/);   // "MODE ACTIVE (full)." dropped from the reminder
});
