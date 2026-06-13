import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VALID_LEVELS, DEFAULT_LEVEL, detectLevelChange, configuredDefaultLevel,
  readLevel, writeLevel, clearLevel, reminderText, rulesetText,
} from "../../plugins/cave-context/mcp/caveman.mjs";

function freshDir() { return mkdtempSync(join(tmpdir(), "cc-")); }

// Run fn with HOME pointed at a clean temp dir and CLAUDE_PROJECT_DIR unset, so
// configuredDefaultLevel() does not read the test runner's real environment.
function withCleanEnv(fn) {
  const savedHome = process.env.HOME;
  const savedProj = process.env.CLAUDE_PROJECT_DIR;
  const dir = freshDir();
  process.env.HOME = dir;
  delete process.env.CLAUDE_PROJECT_DIR;
  try { return fn(dir); }
  finally {
    if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
    if (savedProj === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = savedProj;
    rmSync(dir, { recursive: true, force: true });
  }
}

// Write a settings.json under <base>/.claude/<name> with the given caveman_level.
function writeSettings(base, name, level) {
  const claudeDir = join(base, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const body = level === undefined
    ? { pluginConfigs: { "cave-context": { options: {} } } }
    : { pluginConfigs: { "cave-context": { options: { caveman_level: level } } } };
  writeFileSync(join(claudeDir, name), JSON.stringify(body));
}

test("levels + default", () => {
  assert.deepEqual(VALID_LEVELS, ["lite", "full", "ultra"]);
  assert.equal(DEFAULT_LEVEL, "lite");
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

test("writeLevel refuses invalid level (no silent overwrite)", () => {
  const dir = freshDir();
  try {
    writeLevel(dir, "ultra");
    assert.equal(writeLevel(dir, "not-a-level"), false); // refuses and writes nothing
    assert.equal(readLevel(dir), "ultra");               // file unchanged
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readLevel rejects invalid persisted content", () => {
  const dir = freshDir();
  try {
    // Write junk directly, bypassing writeLevel's guard, so readLevel's own guards are exercised.
    writeFileSync(join(dir, "active-level"), "not-a-level");
    assert.equal(readLevel(dir), null);                  // invalid-content guard
    writeFileSync(join(dir, "active-level"), "x".repeat(100));
    assert.equal(readLevel(dir), null);                  // oversize guard (MAX_BYTES=16)
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("detectLevelChange — slash + natural language", () => {
  withCleanEnv(() => {
    assert.equal(detectLevelChange("/caveman ultra"), "ultra");
    assert.equal(detectLevelChange("/cave-context lite"), "lite");
    // Bare /caveman + natural-language activate resolve through configuredDefaultLevel();
    // with a clean env (no settings) that is DEFAULT_LEVEL = "lite".
    assert.equal(detectLevelChange("/caveman"), DEFAULT_LEVEL);
    assert.equal(detectLevelChange("please talk like caveman"), DEFAULT_LEVEL);
    assert.equal(detectLevelChange("stop caveman"), "off");
    assert.equal(detectLevelChange("normal mode please"), "off");
    assert.equal(detectLevelChange("what is the weather"), null);
  });
});

test("configuredDefaultLevel — no settings file → DEFAULT_LEVEL (lite)", () => {
  withCleanEnv(() => {
    assert.equal(configuredDefaultLevel(), "lite");
  });
});

test("configuredDefaultLevel — user settings (HOME) sets the level", () => {
  withCleanEnv((home) => {
    writeSettings(home, "settings.json", "ultra");
    assert.equal(configuredDefaultLevel(), "ultra");
  });
});

test("configuredDefaultLevel — invalid level falls back to lite (fail-open)", () => {
  withCleanEnv((home) => {
    writeSettings(home, "settings.json", "not-a-level");
    assert.equal(configuredDefaultLevel(), "lite");
  });
});

test("configuredDefaultLevel — malformed JSON falls back to lite (fail-open)", () => {
  withCleanEnv((home) => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), "{ not json");
    assert.equal(configuredDefaultLevel(), "lite");
  });
});

test("configuredDefaultLevel — precedence local > project > user", () => {
  withCleanEnv((home) => {
    const proj = freshDir();
    try {
      process.env.CLAUDE_PROJECT_DIR = proj;
      // user = ultra, project = full, local = lite → local wins.
      writeSettings(home, "settings.json", "ultra");
      writeSettings(proj, "settings.json", "full");
      writeSettings(proj, "settings.local.json", "lite");
      assert.equal(configuredDefaultLevel(), "lite");
      // Drop local → project wins.
      rmSync(join(proj, ".claude", "settings.local.json"), { force: true });
      assert.equal(configuredDefaultLevel(), "full");
      // Drop project → user wins.
      rmSync(join(proj, ".claude", "settings.json"), { force: true });
      assert.equal(configuredDefaultLevel(), "ultra");
    } finally {
      delete process.env.CLAUDE_PROJECT_DIR;
      rmSync(proj, { recursive: true, force: true });
    }
  });
});

test("ruleset + reminder are caveman:compress and level-aware", () => {
  assert.match(rulesetText("full"), /CAVE-CONTEXT MODE ACTIVE/);
  assert.match(rulesetText("full"), /Drop: articles/);
  assert.match(reminderText("ultra"), /ultra/);
});
