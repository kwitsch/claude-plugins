import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = new URL("../../plugins/cave-context/hooks/sessionstartup.mjs", import.meta.url).pathname;
const FAKE_SS = JSON.stringify(["node", new URL("./fake-sessionstart-upstream.mjs", import.meta.url).pathname]);

function run(envExtra, sourceObj) {
  const home = mkdtempSync(join(tmpdir(), "cc-su-home-"));
  try {
    const env = { ...process.env, HOME: home, ...envExtra };
    const res = spawnSync("node", [HOOK], { env, input: JSON.stringify(sourceObj), encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// sessionstartup.mjs is the SessionStart hook matched `startup`. It delegates to context-mode
// purely to trigger its startup-only side-effects (CLAUDE.md capture, old-session GC,
// session_start lifecycle anchor) and ALWAYS emits {} — it injects no continuity and never
// passes context-mode's routing block through (that would double-inject the rules; the caveman
// ruleset comes from the static `cat hooks/SessionStart.md` hook). It never emits a present
// additionalContext: null (Claude Code's SessionStart schema rejects it).

test("startup with upstream disabled emits {}", () => {
  const out = run({ CAVE_CONTEXT_NO_UPSTREAM: "1" }, { source: "startup" });
  assert.deepEqual(out, {});
});

test("startup emits {} even when upstream returns routing + continuity (side-effects only, never injects)", () => {
  const out = run({ CAVE_CONTEXT_HOOK_CMD: FAKE_SS }, { source: "startup" });
  assert.deepEqual(out, {}); // context-mode's response is consumed for side-effects, never surfaced
});
