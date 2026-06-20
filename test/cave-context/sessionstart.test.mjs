import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = new URL("../../plugins/cave-context/hooks/sessionstart.mjs", import.meta.url).pathname;
const FAKE_SS = JSON.stringify(["node", new URL("./fake-sessionstart-upstream.mjs", import.meta.url).pathname]);

function run(envExtra, sourceObj) {
  const home = mkdtempSync(join(tmpdir(), "cc-ss-home-"));
  try {
    const env = { ...process.env, HOME: home, ...envExtra };
    const res = spawnSync("node", [HOOK], { env, input: JSON.stringify(sourceObj), encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// New contract: sessionstart.mjs no longer emits the caveman ruleset (that is now the
// static `cat hooks/SessionStart.md` second SessionStart hook). additionalContext is the
// restored continuity payload on resume/compact, else null.

test("fresh startup with upstream disabled emits no ruleset and no continuity", () => {
  const out = run({ CAVE_CONTEXT_NO_UPSTREAM: "1" }, { source: "startup" });
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.equal(out.hookSpecificOutput.additionalContext, null);
});

test("compact restores continuity only (routing dropped, no ruleset prefix)", () => {
  const out = run({ CAVE_CONTEXT_HOOK_CMD: FAKE_SS }, { source: "compact" });
  const ac = out.hookSpecificOutput.additionalContext;
  assert.match(ac, /<session_knowledge source="compact">/); // continuity present
  assert.ok(!ac.includes("ctx_routing"));                    // context-mode routing block dropped
  assert.doesNotMatch(ac, /CAVE-CONTEXT MODE ACTIVE/);       // no ruleset prefix anymore
});

test("clear source never restores continuity even if upstream returns it", () => {
  const out = run({ CAVE_CONTEXT_HOOK_CMD: FAKE_SS }, { source: "clear" });
  assert.equal(out.hookSpecificOutput.additionalContext, null);
});
