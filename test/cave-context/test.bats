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

@test "userpromptsubmit shim emits caveman reminder after /caveman ultra" {
  tmp="$(mktemp -d)"
  run env CLAUDE_PLUGIN_DATA="$tmp" CAVE_CONTEXT_NO_UPSTREAM=1 \
    node "$REPO_ROOT/plugins/cave-context/hooks/userpromptsubmit.mjs" <<< '{"hook_event_name":"UserPromptSubmit","prompt":"/caveman ultra"}'
  assert_success
  assert_output --partial "ultra"
  rm -rf "$tmp"
}

@test "pretooluse shim runs without error (no upstream)" {
  run env CAVE_CONTEXT_NO_UPSTREAM=1 \
    node "$REPO_ROOT/plugins/cave-context/hooks/pretooluse.mjs" <<< '{"hook_event_name":"PreToolUse","tool_name":"Bash"}'
  assert_success
}

@test "posttooluse shim runs without error (no upstream)" {
  run env CAVE_CONTEXT_NO_UPSTREAM=1 \
    node "$REPO_ROOT/plugins/cave-context/hooks/posttooluse.mjs" <<< '{"hook_event_name":"PostToolUse","tool_name":"Bash"}'
  assert_success
}

@test "precompact shim runs without error (no upstream)" {
  run env CAVE_CONTEXT_NO_UPSTREAM=1 \
    node "$REPO_ROOT/plugins/cave-context/hooks/precompact.mjs" <<< '{"hook_event_name":"PreCompact"}'
  assert_success
}

@test "stat skill exists with valid frontmatter name" {
  run grep -qE '^name:\s*stat$' "$REPO_ROOT/plugins/cave-context/skills/stat/SKILL.md"
  assert_success
}
