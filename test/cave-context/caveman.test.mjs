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
  assert.match(r, /ctx_\*/);                         // routing nudge aligned with SessionStart
  assert.match(r, /write normal/i);                  // boundary wording matches the ruleset
});

test("condensed rulesetText keeps every behavioral anchor and stays under budget", () => {
  const r = rulesetText();
  // Load-bearing markers (other tests + the SessionStart contract depend on these):
  assert.match(r, /CAVE-CONTEXT MODE ACTIVE/);
  assert.match(r, /level: full/);
  assert.match(r, /Drop: articles/);
  // Behavioral substance preserved (two micro-phrasings folded into the terse-intent line):
  assert.match(r, /terse/i);                       // terse caveman intent
  assert.match(r, /every response/i);              // persistence
  assert.match(r, /Fragments OK/);                 // fragments allowed
  assert.match(r, /code blocks?/i);                // code blocks unchanged
  assert.match(r, /errors?/i);                     // errors quoted exact
  assert.match(r, /\[thing\] \[action\] \[reason\]/); // pattern
  assert.match(r, /irreversible/i);                // auto-clarity trigger
  assert.match(r, /security/i);                    // auto-clarity trigger
  assert.match(r, /commits/i);                     // boundaries: code/commits/PRs normal
  // Full cave-compress alignment (GRAMMAR + SYMBOLS + BOUNDARIES) is larger than the
  // 0.4.1 condensed baseline; keep a regression budget at the new size.
  assert.match(r, /→/);                              // SYMBOLS table present
  assert.match(r, /symbol-spam/i);                   // symbol guardrail kept
  assert.match(r, /amputation/i);                    // WHEN-UNSURE rule
  assert.ok(r.length < 1000, `rulesetText length ${r.length} not under budget`);
});
