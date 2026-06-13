#!/usr/bin/env bats

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOKS="$REPO_ROOT/plugins/cave-context/hooks/hooks.json"
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS"
  assert_success
}

@test ".mcp.json registers the cave-context server" {
  run jq -e '.mcpServers["cave-context"].command' "$REPO_ROOT/plugins/cave-context/.mcp.json"
  assert_success
}

@test "SessionStart is a prompt hook" {
  run jq -e '.hooks.SessionStart[0].hooks[0].type == "prompt"' "$HOOKS"
  assert_success
}

@test "mid-loop + lifecycle hooks are mcp_tool on the cave-context server" {
  run jq -e '[.hooks.PreToolUse,.hooks.PostToolUse,.hooks.UserPromptSubmit,.hooks.PreCompact] | flatten | map(.hooks[0]) | all(.type=="mcp_tool" and .server=="cave-context")' "$HOOKS"
  assert_success
}

@test "no PreToolUse/PostToolUse matcher matches the hook_ tools (reentrancy guard)" {
  run jq -e '[.hooks.PreToolUse[],.hooks.PostToolUse[]] | all(.matcher | test("hook_") | not)' "$HOOKS"
  assert_success
}

@test "plugin.json is valid JSON" {
  run jq empty "$REPO_ROOT/plugins/cave-context/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin.json has version" {
  run jq -e '.version' "$REPO_ROOT/plugins/cave-context/.claude-plugin/plugin.json"
  assert_success
}
