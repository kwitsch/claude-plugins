import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VALID_LEVELS, DEFAULT_LEVEL, detectLevelChange,
  readLevel, writeLevel, clearLevel, reminderText, rulesetText,
} from "../../plugins/cave-context/mcp/caveman.mjs";

function freshDir() { return mkdtempSync(join(tmpdir(), "cc-")); }

test("levels + default", () => {
  assert.deepEqual(VALID_LEVELS, ["lite", "full", "ultra"]);
  assert.equal(DEFAULT_LEVEL, "full");
});

test("write/read/clear level round-trip", () => {
  const dir = freshDir();
  try {
    writeLevel(dir, "ultra");
    assert.equal(readLevel(dir), "ultra");
    clearLevel(dir);
    assert.equal(readLevel(dir), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readLevel rejects junk", () => {
  const dir = freshDir();
  try {
    writeLevel(dir, "ultra");
    // overwrite with junk
    writeLevel(dir, "not-a-level"); // must refuse to persist invalid
    assert.equal(readLevel(dir), "ultra");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("detectLevelChange — slash + natural language", () => {
  assert.equal(detectLevelChange("/caveman ultra"), "ultra");
  assert.equal(detectLevelChange("/cave-context lite"), "lite");
  assert.equal(detectLevelChange("/caveman"), DEFAULT_LEVEL);
  assert.equal(detectLevelChange("please talk like caveman"), DEFAULT_LEVEL);
  assert.equal(detectLevelChange("stop caveman"), "off");
  assert.equal(detectLevelChange("normal mode please"), "off");
  assert.equal(detectLevelChange("what is the weather"), null);
});

test("ruleset + reminder are caveman:compress and level-aware", () => {
  assert.match(rulesetText("full"), /CAVE-CONTEXT MODE ACTIVE/);
  assert.match(rulesetText("full"), /Drop: articles/);
  assert.match(reminderText("ultra"), /ultra/);
});
