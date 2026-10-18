import { test } from "node:test";
import assert from "node:assert/strict";
import { REROUTE_TARGET, normalize, rerouteType } from "../../plugins/cc-knowledge/hooks/reroute.mjs";

test("REROUTE_TARGET is the plugin's expert agent", () => {
  assert.equal(REROUTE_TARGET, "cc-knowledge:claude-code-expert");
});

test("normalize lowercases, collapses separator runs to - and trims them", () => {
  assert.equal(normalize("Claude Code Guide"), "claude-code-guide");
  assert.equal(normalize("__claude_code--guide__"), "claude-code-guide");
  assert.equal(normalize(undefined), "");
  assert.equal(normalize(null), "");
});

test("rerouteType sends every spelling of claude-code-guide to the expert", () => {
  for (const t of ["claude-code-guide", "Claude Code Guide", "CLAUDE_CODE_GUIDE", " claude-code-guide "]) {
    assert.equal(rerouteType(t), REROUTE_TARGET, t);
  }
});

test("rerouteType leaves every other type unchanged, the target included (loop-safe)", () => {
  for (const t of ["general-purpose", "Explore", REROUTE_TARGET, "claude-code-guide-x", "", undefined]) {
    assert.equal(rerouteType(t), t);
  }
});
