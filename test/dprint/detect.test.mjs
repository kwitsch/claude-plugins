import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_PATHS, dprintCandidates, isEnabled, missingDprintWarning } from "../../plugins/dprint/hooks/detect.mjs";

test('isEnabled: fail-open, only a literal false (boolean or "false") disables', () => {
  assert.equal(isEnabled(true), true);
  assert.equal(isEnabled("true"), true);
  assert.equal(isEnabled(""), true);
  assert.equal(isEnabled(undefined), true);
  assert.equal(isEnabled("${user_config.warn_missing_dprint}"), true);
  assert.equal(isEnabled(false), false);
  assert.equal(isEnabled("false"), false);
});

test("CONFIG_PATHS: the four names in cwd, then in .config/, in this exact order", () => {
  assert.deepEqual(CONFIG_PATHS, ["dprint.json", "dprint.jsonc", ".dprint.json", ".dprint.jsonc", ".config/dprint.json", ".config/dprint.jsonc", ".config/.dprint.json", ".config/.dprint.jsonc"]);
});

test("dprintCandidates: each non-empty PATH entry's dprint, then ~/.dprint/bin/dprint", () => {
  assert.deepEqual(dprintCandidates("/a::/b", "/h"), ["/a/dprint", "/b/dprint", "/h/.dprint/bin/dprint"]);
});

test("dprintCandidates: PATH and HOME unset give no candidates", () => {
  assert.deepEqual(dprintCandidates(undefined, undefined), []);
});

test("dprintCandidates: an empty HOME adds no fallback", () => {
  assert.deepEqual(dprintCandidates("/a", ""), ["/a/dprint"]);
});

test("missingDprintWarning: names the config and the init skill, never the plugin as a prefix", () => {
  const text = missingDprintWarning(".config/dprint.json");
  assert.ok(text.includes(".config/dprint.json"));
  assert.ok(text.includes("/dprint:init-dprint"));
  assert.ok(!text.startsWith("dprint:"));
});
