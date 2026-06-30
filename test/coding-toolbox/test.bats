#!/usr/bin/env bats

# Tests for the coding-toolbox plugin (golden behavior rules hooks).

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/coding-toolbox"
  HOOKS="$PLUGIN/hooks"
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
  run grep -F "[coding-toolbox](plugins/coding-toolbox/README.md)" "$REPO_ROOT/README.md"
  assert_success
}

@test "plugin is in the test.yml matrix" {
  run grep -E "^\s*-\s*coding-toolbox\s*$" "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}

@test "SessionStart.md exists and is non-empty" {
  run test -s "$HOOKS/SessionStart.md"
  assert_success
}

@test "SessionStart.md covers all three axes and cites all three sources" {
  run cat "$HOOKS/SessionStart.md"
  assert_success
  assert_output --partial "Language"
  assert_output --partial "Behavior"
  assert_output --partial "Mentality"
  assert_output --partial "cavemem"
  assert_output --partial "andrej-karpathy-skills"
  assert_output --partial "ponytail-lite"
}

# Anti-flip tripwire: PreToolUse.json is a valid PreToolUse payload with a non-empty
# additionalContext and NO permissionDecision (which would interfere with the permission flow).
@test "PreToolUse.json is a valid PreToolUse additionalContext payload" {
  run jq -e '.hookSpecificOutput.hookEventName == "PreToolUse" and (.hookSpecificOutput.additionalContext | length > 0) and (.hookSpecificOutput | has("permissionDecision") | not)' "$HOOKS/PreToolUse.json"
  assert_success
}
