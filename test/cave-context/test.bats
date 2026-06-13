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

@test ".mcp.json registers the cave-context server via mjsx.sh launcher" {
  MCP="$REPO_ROOT/plugins/cave-context/.mcp.json"
  cmd="$(jq -r '.mcpServers["cave-context"].command' "$MCP")"
  [[ "$cmd" == *bin/mjsx.sh ]]
  # The server.mjs is passed as the first arg to the launcher, not the command.
  run jq -e '.mcpServers["cave-context"].args[0] | endswith("mcp/server.mjs")' "$MCP"
  assert_success
}

@test "SessionStart command hook launches via mjsx.sh with sessionstart.mjs in args" {
  run jq -e '.hooks.SessionStart[0].hooks[0].type == "command"' "$HOOKS"
  assert_success
  cmd="$(jq -r '.hooks.SessionStart[0].hooks[0].command' "$HOOKS")"
  # Command is now the launcher, NOT the .mjs.
  [[ "$cmd" == *bin/mjsx.sh ]]
  [[ "$cmd" != *sessionstart.mjs ]]
  # The .mjs script path appears in args.
  run jq -e '.hooks.SessionStart[0].hooks[0].args[0] | endswith("hooks/sessionstart.mjs")' "$HOOKS"
  assert_success
}

@test "UserPromptSubmit + PreCompact command hooks launch via mjsx.sh with their .mjs in args" {
  for ev in UserPromptSubmit PreCompact; do
    cmd="$(jq -r ".hooks.${ev}[0].hooks[0].command" "$HOOKS")"
    [[ "$cmd" == *bin/mjsx.sh ]]
  done
  run jq -e '.hooks.UserPromptSubmit[0].hooks[0].args[0] | endswith("hooks/userpromptsubmit.mjs")' "$HOOKS"
  assert_success
  run jq -e '.hooks.PreCompact[0].hooks[0].args[0] | endswith("hooks/precompact.mjs")' "$HOOKS"
  assert_success
}

@test "bin/mjsx.sh exists and is executable" {
  [ -x "$REPO_ROOT/plugins/cave-context/bin/mjsx.sh" ]
}

@test "PreToolUse + PostToolUse are mcp_tool on the cave-context server" {
  run jq -e '[.hooks.PreToolUse,.hooks.PostToolUse] | flatten | map(.hooks[0]) | all(.type=="mcp_tool" and .server=="cave-context")' "$HOOKS"
  assert_success
}

@test "SessionStart + UserPromptSubmit + PreCompact are command hooks" {
  run jq -e '[.hooks.SessionStart,.hooks.UserPromptSubmit,.hooks.PreCompact] | flatten | map(.hooks[0]) | all(.type=="command")' "$HOOKS"
  assert_success
}

@test "no command hook command starts with 'node '" {
  run jq -e '[.hooks | to_entries[].value[].hooks[] | select(.type=="command") | .command] | all(startswith("node ") | not)' "$HOOKS"
  assert_success
}

@test "referenced command-hook files exist and are executable" {
  for f in sessionstart.mjs userpromptsubmit.mjs precompact.mjs; do
    [ -x "$REPO_ROOT/plugins/cave-context/hooks/$f" ]
  done
}

@test "sessionstart.mjs emits valid JSON with the caveman ruleset marker" {
  # sessionstart.mjs now seeds the state file under CLAUDE_PLUGIN_DATA and reads
  # ${HOME}/.claude/settings.json for the configured level — isolate both so the
  # test never writes to the real ~/.claude/cave-context/ and stays deterministic.
  tmp="$(mktemp -d)"
  home="$(mktemp -d)"
  run env CLAUDE_PLUGIN_DATA="$tmp" HOME="$home" \
    node "$REPO_ROOT/plugins/cave-context/hooks/sessionstart.mjs" < /dev/null
  assert_success
  run bash -c 'env CLAUDE_PLUGIN_DATA="'"$tmp"'" HOME="'"$home"'" node "'"$REPO_ROOT"'/plugins/cave-context/hooks/sessionstart.mjs" < /dev/null | jq -r ".hookSpecificOutput.additionalContext"'
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

@test "plugin.json userConfig keys are exactly [caveman_level]" {
  PJ="$REPO_ROOT/plugins/cave-context/.claude-plugin/plugin.json"
  run jq -e '(.userConfig | keys) == ["caveman_level"]' "$PJ"
  assert_success
}

@test "plugin.json caveman_level userConfig is a string defaulting to lite" {
  PJ="$REPO_ROOT/plugins/cave-context/.claude-plugin/plugin.json"
  run jq -e '.userConfig.caveman_level | .type == "string" and .default == "lite" and (.title|length>0) and (.description|length>0)' "$PJ"
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

@test "node unit tests pass" {
  run node --test "$REPO_ROOT/test/cave-context/"*.test.mjs
  assert_success
}
