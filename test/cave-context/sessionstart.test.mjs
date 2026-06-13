import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = new URL("../../plugins/cave-context/hooks/sessionstart.mjs", import.meta.url).pathname;

test("sessionstart prints the always-full ruleset and writes no state file", () => {
  const data = mkdtempSync(join(tmpdir(), "cc-ss-data-"));
  const home = mkdtempSync(join(tmpdir(), "cc-ss-home-"));
  try {
    const env = { ...process.env, CLAUDE_PLUGIN_DATA: data, HOME: home };
    delete env.CLAUDE_PROJECT_DIR;
    const res = spawnSync("node", [HOOK], { env, input: "", encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);

    // SessionStart additionalContext announces the always-full mode.
    const out = JSON.parse(res.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(out.hookSpecificOutput.additionalContext, /CAVE-CONTEXT MODE ACTIVE/);
    assert.match(out.hookSpecificOutput.additionalContext, /level: full/);

    // No runtime level state exists anymore — nothing is seeded.
    assert.ok(!existsSync(join(data, "active-level")));
  } finally {
    rmSync(data, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
