#!/usr/bin/env bats

# plugin.json / marketplace.json / CI-matrix invariants — linux-token-efficiency.

load 'test_helper'

setup() {
  common_setup
}

@test "plugin.json is valid JSON with name and version 0.6.0" {
  run jq -e '.name == "linux-token-efficiency" and .version == "0.6.0"' "$MANIFEST"
  assert_success
}

@test "plugin.json description states Linux-only targeting" {
  run jq -e '(.description | test("(?i)linux")) and (.description | test("(?i)does not work"))' "$MANIFEST"
  assert_success
}

@test "plugin.json declares exactly the auto_rewrite, cbm_enabled and steer_enabled boolean toggles, all default true" {
  run jq -e '.userConfig | keys == ["auto_rewrite","cbm_enabled","steer_enabled"]' "$MANIFEST"
  assert_success
  run jq -e '.userConfig | .auto_rewrite.type == "boolean" and .auto_rewrite.default == true and (.auto_rewrite.title | length > 0) and (.auto_rewrite.description | length > 0)' "$MANIFEST"
  assert_success
  run jq -e '.userConfig | .cbm_enabled.type == "boolean" and .cbm_enabled.default == true and (.cbm_enabled.title | length > 0) and (.cbm_enabled.description | length > 0)' "$MANIFEST"
  assert_success
  run jq -e '.userConfig | .steer_enabled.type == "boolean" and .steer_enabled.default == true and (.steer_enabled.title | length > 0) and (.steer_enabled.description | length > 0)' "$MANIFEST"
  assert_success
}

@test "plugin.json declares an author" {
  run jq -e '.author.name == "Kwitsch"' "$MANIFEST"
  assert_success
}

@test "marketplace.json has exactly one linux-token-efficiency entry, no version field" {
  run jq -e '[.plugins[] | select(.name == "linux-token-efficiency" and .source == "./plugins/linux-token-efficiency")] | length == 1' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
  run jq -e '[.plugins[] | select(.name == "linux-token-efficiency") | has("version")] | any | not' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "marketplace.json entry repeats the Linux-only wording, is categorized and tagged for context-mode" {
  run jq -e '.plugins[] | select(.name == "linux-token-efficiency") | (.description | test("(?i)linux")) and (.description | test("(?i)does not work")) and .category == "productivity" and (.tags | index("rtk") != null) and (.tags | index("codebase-memory-mcp") != null) and (.tags | index("mcp") != null) and (.tags | index("context-mode") != null)' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "plugin.json and marketplace.json descriptions both mention codebase-memory-mcp and context-mode" {
  run jq -e '(.description | test("codebase-memory-mcp")) and (.description | test("context-mode"))' "$MANIFEST"
  assert_success
  run jq -e '.plugins[] | select(.name == "linux-token-efficiency") | (.description | test("codebase-memory-mcp")) and (.description | test("context-mode"))' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "test.yml matrix runs the linux-token-efficiency suite" {
  run grep -F -- '- linux-token-efficiency' "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}
