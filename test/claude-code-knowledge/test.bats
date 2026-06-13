#!/usr/bin/env bats
# Tests for the claude-code-knowledge plugin: manifest invariants, the two
# command hooks (redirect-guide, session-cache), the cc-knowledge agent,
# the shared references, the cck-* skills, and the hermetic harness selftest.

setup() {
  bats_require_minimum_version 1.5.0
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/claude-code-knowledge"
  BIN="$PLUGIN/bin"
}

@test "plugin.json is valid JSON" {
  run -0 jq empty "$PLUGIN/.claude-plugin/plugin.json"
}

@test "plugin.json declares the right name and a version" {
  run -0 jq -e '.name == "claude-code-knowledge" and (.version | type == "string")' \
    "$PLUGIN/.claude-plugin/plugin.json"
}

@test "marketplace lists the plugin and carries no version field there" {
  run -0 jq -e '.plugins[] | select(.name == "claude-code-knowledge") | (has("version") | not)' \
    "$REPO_ROOT/.claude-plugin/marketplace.json"
}

# --- redirect-guide (PreToolUse Agent|Task reroute) ---

@test "redirect-guide reroutes claude-code-guide on the Agent tool" {
  in='{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"subagent_type":"claude-code-guide","description":"d","prompt":"p"}}'
  run -0 bash -c 'printf "%s" "$1" | "$2"' _ "$in" "$BIN/redirect-guide"
  echo "$output" | jq -e '.hookSpecificOutput.permissionDecision == "allow"'
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.subagent_type == "claude-code-knowledge:cc-knowledge"'
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.description == "d"'
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.prompt == "p"'
}

@test "redirect-guide reroutes on the legacy Task tool name" {
  in='{"hook_event_name":"PreToolUse","tool_name":"Task","tool_input":{"subagent_type":"claude-code-guide","description":"d","prompt":"p"}}'
  run -0 bash -c 'printf "%s" "$1" | "$2"' _ "$in" "$BIN/redirect-guide"
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.subagent_type == "claude-code-knowledge:cc-knowledge"'
}

@test "redirect-guide normalizes a case/separator variant" {
  in='{"tool_name":"Agent","tool_input":{"subagent_type":"Claude Code Guide","description":"d","prompt":"p"}}'
  run -0 bash -c 'printf "%s" "$1" | "$2"' _ "$in" "$BIN/redirect-guide"
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.subagent_type == "claude-code-knowledge:cc-knowledge"'
}

@test "redirect-guide is silent for other subagents" {
  in='{"tool_name":"Agent","tool_input":{"subagent_type":"general-purpose","description":"d","prompt":"p"}}'
  run -0 bash -c 'printf "%s" "$1" | "$2"' _ "$in" "$BIN/redirect-guide"
  assert_output ""
}

@test "hooks.json registers PreToolUse(Agent|Task) -> redirect-guide" {
  f="$PLUGIN/hooks/hooks.json"
  run -0 jq -e '.hooks.PreToolUse[0].matcher == "Agent|Task"' "$f"
  run -0 jq -e '.hooks.PreToolUse[0].hooks[0].type == "command"' "$f"
  run -0 jq -e '.hooks.PreToolUse[0].hooks[0].command | test("redirect-guide")' "$f"
}
