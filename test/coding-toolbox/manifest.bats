#!/usr/bin/env bats

# Plugin manifest, marketplace registration, and top-level README structure — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "plugin.json is valid JSON with name/version/description" {
  run jq -e '.name == "coding-toolbox" and (.version | type == "string") and (.description | length > 0)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}
@test "plugin is registered in marketplace.json" {
  run jq -e '[.plugins[] | select(.name == "coding-toolbox" and .source == "./plugins/coding-toolbox")] | length == 1' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}
@test "marketplace.json entry carries no version field" {
  run jq -e '[.plugins[] | select(.name == "coding-toolbox") | has("version")] | any | not' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}
@test "plugin has a root README table row" {
  run rg_or_grep -F "[coding-toolbox](plugins/coding-toolbox/README.md)" "$REPO_ROOT/README.md"
  assert_success
}
@test "plugin is in the test.yml matrix" {
  run rg_or_grep -E "^\s*-\s*coding-toolbox\s*$" "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}
@test "plugin README first ## heading is Install" {
  run bash -c "rg_or_grep -m1 '^## ' '$PLUGIN/README.md'"
  assert_success
  assert_output "## Install"
}
@test "plugin README contains the install command" {
  run rg_or_grep -F "/plugin install coding-toolbox@kwitsch-plugins" "$PLUGIN/README.md"
  assert_success
}
@test "plugin README has no ## Hooks section" {
  run rg_or_grep -E "^## Hooks" "$PLUGIN/README.md"
  assert_failure
}
@test "plugin.json version bumped for the setup-rules parse-args script extraction (this unreleased branch)" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output "0.23.3"
}
