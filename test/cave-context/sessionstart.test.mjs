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
    delete env.CLAUDE_PLUGIN_ROOT; // keep cache-heal a no-op in tests
    const res = spawnSync("node", [HOOK], { env, input: JSON.stringify(sourceObj), encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("always emits the condensed cave-context block", () => {
  const out = run({ CAVE_CONTEXT_NO_UPSTREAM: "1" }, { source: "startup" });
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, /CAVE-CONTEXT MODE ACTIVE/);
});

test("fresh startup with upstream disabled = condensed block only (no continuity)", () => {
  const out = run({ CAVE_CONTEXT_NO_UPSTREAM: "1" }, { source: "startup" });
  assert.ok(!out.hookSpecificOutput.additionalContext.includes("session_knowledge"));
});

test("compact merges the extracted continuity after the condensed block, drops routing", () => {
  const out = run({ CAVE_CONTEXT_HOOK_CMD: FAKE_SS }, { source: "compact" });
  const ac = out.hookSpecificOutput.additionalContext;
  assert.match(ac, /CAVE-CONTEXT MODE ACTIVE/);          // condensed block present
  assert.match(ac, /<session_knowledge source="compact">/); // continuity present
  assert.ok(!ac.includes("ctx_routing"));                 // context-mode routing block dropped
  assert.ok(ac.indexOf("CAVE-CONTEXT") < ac.indexOf("session_knowledge")); // condensed first
});

test("clear source never restores continuity even if upstream returns it", () => {
  const out = run({ CAVE_CONTEXT_HOOK_CMD: FAKE_SS }, { source: "clear" });
  assert.match(out.hookSpecificOutput.additionalContext, /CAVE-CONTEXT MODE ACTIVE/);
  assert.ok(!out.hookSpecificOutput.additionalContext.includes("session_knowledge"));
});
