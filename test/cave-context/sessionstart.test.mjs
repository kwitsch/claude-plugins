import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = new URL("../../plugins/cave-context/hooks/sessionstart.mjs", import.meta.url).pathname;

test("sessionstart seeds the state file at the configured level and prints additionalContext", () => {
  const data = mkdtempSync(join(tmpdir(), "cc-ss-data-"));
  const home = mkdtempSync(join(tmpdir(), "cc-ss-home-"));
  try {
    // Clean env: no settings → configured level falls back to DEFAULT_LEVEL ("lite").
    const env = { ...process.env, CLAUDE_PLUGIN_DATA: data, HOME: home };
    delete env.CLAUDE_PROJECT_DIR;
    const res = spawnSync("node", [HOOK], { env, input: "", encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);

    // State file seeded with the configured level.
    const seeded = readFileSync(join(data, "active-level"), "utf8").trim();
    assert.equal(seeded, "lite");

    // SessionStart additionalContext announces the mode.
    const out = JSON.parse(res.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(out.hookSpecificOutput.additionalContext, /CAVE-CONTEXT MODE ACTIVE/);
  } finally {
    rmSync(data, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("sessionstart honors a configured caveman_level from user settings.json", () => {
  const data = mkdtempSync(join(tmpdir(), "cc-ss-data-"));
  const home = mkdtempSync(join(tmpdir(), "cc-ss-home-"));
  try {
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.json"),
      JSON.stringify({ pluginConfigs: { "cave-context": { options: { caveman_level: "ultra" } } } }));

    const env = { ...process.env, CLAUDE_PLUGIN_DATA: data, HOME: home };
    delete env.CLAUDE_PROJECT_DIR;
    const res = spawnSync("node", [HOOK], { env, input: "", encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readFileSync(join(data, "active-level"), "utf8").trim(), "ultra");
  } finally {
    rmSync(data, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
