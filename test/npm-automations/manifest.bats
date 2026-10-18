#!/usr/bin/env bats

# Plugin manifest, marketplace registration, and top-level README structure — npm-automations plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "plugin.json is valid JSON with name/version/description" {
  run jq -e '.name == "npm-automations" and (.version | type == "string") and (.description | length > 0)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}
@test "plugin is registered in marketplace.json" {
  run jq -e '[.plugins[] | select(.name == "npm-automations" and .source == "./plugins/npm-automations")] | length == 1' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}
@test "marketplace.json entry carries no version field" {
  run jq -e '[.plugins[] | select(.name == "npm-automations") | has("version")] | any | not' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}
@test "plugin has a root README table row" {
  run rg_or_grep -F "[npm-automations](plugins/npm-automations/README.md)" "$REPO_ROOT/README.md"
  assert_success
}
@test "plugin is in the test.yml matrix" {
  run rg_or_grep -E "^\s*-\s*npm-automations\s*$" "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}
@test "plugin README first ## heading is Install" {
  run bash -c "rg_or_grep -m1 '^## ' '$PLUGIN/README.md'"
  assert_success
  assert_output "## Install"
}
@test "plugin README contains the install command" {
  run rg_or_grep -F "/plugin install npm-automations@kwitsch-plugins" "$PLUGIN/README.md"
  assert_success
}
@test "plugin README has no ## Hooks section" {
  run rg_or_grep -E "^## Hooks" "$PLUGIN/README.md"
  assert_failure
}
@test "plugin.json version is 1.1.1" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output "1.1.1"
}
@test "userConfig has exactly the expected keys (extend when adding a toggle)" {
  run jq -e '[.userConfig | keys_unsorted | sort[]] == ["npm_ci_on_worktree", "npm_install_on_package_change"]' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}
@test "userConfig toggles are booleans defaulting to true" {
  run jq -e '[.userConfig[] | select(.type == "boolean" and .default == true and (.title | length > 0) and (.description | length > 0))] | length == 2' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}
@test "hooks.json is exactly the mods module list" {
  run jq -e '. == {"modules":["./register.ts"]}' "$HOOKS/hooks.json"
  assert_success
}
@test "mod source and wiring-test files exist, no command-hook scripts left" {
  [ -f "$HOOKS/register.ts" ]
  [ -f "$HOOKS/policy.mjs" ]
  [ -f "$PLUGIN/tests/npm-automations.test.ts" ]
  [ ! -e "$HOOKS/npm-ci-on-worktree.mjs" ]
  [ ! -e "$HOOKS/npm-install-on-package-change.mjs" ]
}
# core.fileMode = false in this repo, so `[ -x ]` passes even when git recorded 100644 — assert the index.
@test "hooks/policy.mjs is 100755 in the git index (hooks-executable rule)" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/npm-automations/hooks/policy.mjs
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/npm-automations/hooks/policy\.mjs$'
}
@test "claude plugin validate succeeds" {
  command -v claude >/dev/null || skip "claude CLI unavailable"
  run claude plugin validate "$PLUGIN"
  assert_success
}
@test "claude plugin test succeeds" {
  command -v claude >/dev/null || skip "claude CLI unavailable"
  run claude plugin test "$PLUGIN"
  assert_success
}
