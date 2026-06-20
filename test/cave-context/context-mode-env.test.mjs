import { test } from "node:test";
import assert from "node:assert/strict";
import { contextModeEnv } from "../../plugins/cave-context/mcp/context-mode-env.mjs";

test("derives CONTEXT_MODE_DIR under CLAUDE_PLUGIN_DATA", () => {
  assert.equal(contextModeEnv({ CLAUDE_PLUGIN_DATA: "/data" }).CONTEXT_MODE_DIR, "/data/context-mode");
});

test("an explicit CONTEXT_MODE_DIR wins (test isolation)", () => {
  assert.equal(
    contextModeEnv({ CLAUDE_PLUGIN_DATA: "/data", CONTEXT_MODE_DIR: "/explicit" }).CONTEXT_MODE_DIR,
    "/explicit",
  );
});

test("absent CLAUDE_PLUGIN_DATA leaves CONTEXT_MODE_DIR unset (never an 'undefined' path)", () => {
  const env = contextModeEnv({});
  assert.equal(env.CONTEXT_MODE_DIR, undefined);
  // Guard against ever emitting a broken "undefined/context-mode" path on any key.
  for (const v of Object.values(env)) assert.ok(!String(v).includes("undefined"));
});

test("blank CLAUDE_PLUGIN_DATA is treated as unset", () => {
  assert.equal(contextModeEnv({ CLAUDE_PLUGIN_DATA: "   " }).CONTEXT_MODE_DIR, undefined);
});
