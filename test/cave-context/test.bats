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

@test ".mcp.json registers the cave-context server via bnx.sh launcher" {
  MCP="$REPO_ROOT/plugins/cave-context/.mcp.json"
  cmd="$(jq -r '.mcpServers["cave-context"].command' "$MCP")"
  [[ "$cmd" == *bin/bnx.sh ]]
  # The server.mjs is passed as the first arg to the launcher, not the command.
  run jq -e '.mcpServers["cave-context"].args[0] | endswith("mcp/server.mjs")' "$MCP"
  assert_success
}

@test "SessionStart command hook launches via bnx.sh with sessionstart.mjs in args" {
  run jq -e '.hooks.SessionStart[0].hooks[0].type == "command"' "$HOOKS"
  assert_success
  cmd="$(jq -r '.hooks.SessionStart[0].hooks[0].command' "$HOOKS")"
  # Command is now the launcher, NOT the .mjs.
  [[ "$cmd" == *bin/bnx.sh ]]
  [[ "$cmd" != *sessionstart.mjs ]]
  # The .mjs script path appears in args.
  run jq -e '.hooks.SessionStart[0].hooks[0].args[0] | endswith("hooks/sessionstart.mjs")' "$HOOKS"
  assert_success
}

@test "PreCompact command hook launches via bnx.sh with its .mjs in args" {
  cmd="$(jq -r '.hooks.PreCompact[0].hooks[0].command' "$HOOKS")"
  [[ "$cmd" == *bin/bnx.sh ]]
  run jq -e '.hooks.PreCompact[0].hooks[0].args[0] | endswith("hooks/precompact.mjs")' "$HOOKS"
  assert_success
}

@test "ConfigChange hook is not registered (caveman_level userConfig removed)" {
  run jq -e 'has("hooks") and (.hooks | has("ConfigChange") | not)' "$HOOKS"
  assert_success
}

@test "bin/bnx.sh exists and is executable" {
  [ -x "$REPO_ROOT/plugins/cave-context/bin/bnx.sh" ]
}

@test "UserPromptSubmit + PreToolUse + PostToolUse are mcp_tool on the cave-context server" {
  run jq -e '[.hooks.UserPromptSubmit,.hooks.PreToolUse,.hooks.PostToolUse] | flatten | map(.hooks[]) | all(.type=="mcp_tool" and .server=="plugin:cave-context:cave-context")' "$HOOKS"
  assert_success
}

@test "UserPromptSubmit mcp_tool calls hook_userpromptsubmit" {
  run jq -e '.hooks.UserPromptSubmit[0].hooks[0].tool == "hook_userpromptsubmit"' "$HOOKS"
  assert_success
}

@test "SessionStart + PreCompact are command hooks" {
  run jq -e '[.hooks.SessionStart,.hooks.PreCompact] | flatten | map(.hooks[0]) | all(.type=="command")' "$HOOKS"
  assert_success
}

@test "no command hook command starts with 'node '" {
  run jq -e '[.hooks | to_entries[].value[].hooks[] | select(.type=="command") | .command] | all(startswith("node ") | not)' "$HOOKS"
  assert_success
}

@test "referenced command-hook files exist and are executable" {
  for f in sessionstart.mjs precompact.mjs; do
    [ -x "$REPO_ROOT/plugins/cave-context/hooks/$f" ]
  done
}

@test "sessionstart.mjs emits valid JSON with the caveman ruleset marker" {
  # Isolate HOME + CLAUDE_PLUGIN_DATA so the test stays deterministic and never
  # touches the real ~/.claude/. sessionstart no longer seeds any state file.
  tmp="$(mktemp -d)"
  home="$(mktemp -d)"
  run env CAVE_CONTEXT_NO_UPSTREAM=1 CLAUDE_PLUGIN_DATA="$tmp" HOME="$home" \
    node "$REPO_ROOT/plugins/cave-context/hooks/sessionstart.mjs" < /dev/null
  assert_success
  run bash -c 'env CAVE_CONTEXT_NO_UPSTREAM=1 CLAUDE_PLUGIN_DATA="'"$tmp"'" HOME="'"$home"'" node "'"$REPO_ROOT"'/plugins/cave-context/hooks/sessionstart.mjs" < /dev/null | jq -r ".hookSpecificOutput.additionalContext"'
  assert_success
  assert_output --partial "CAVE-CONTEXT MODE ACTIVE"
  rm -rf "$tmp" "$home"
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

@test "plugin.json has no userConfig (caveman level fixed at full)" {
  PJ="$REPO_ROOT/plugins/cave-context/.claude-plugin/plugin.json"
  run jq -e 'has("userConfig") | not' "$PJ"
  assert_success
}

@test "precompact shim runs without error (no upstream)" {
  run env CAVE_CONTEXT_NO_UPSTREAM=1 \
    node "$REPO_ROOT/plugins/cave-context/hooks/precompact.mjs" <<< '{"hook_event_name":"PreCompact"}'
  assert_success
}

@test "node unit tests pass" {
  run node --test "$REPO_ROOT/test/cave-context/"*.test.mjs
  assert_success
}

