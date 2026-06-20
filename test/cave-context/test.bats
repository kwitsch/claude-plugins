#!/usr/bin/env bats

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOKS="$REPO_ROOT/plugins/cave-context/hooks/hooks.json"
  SS_MD="$REPO_ROOT/plugins/cave-context/hooks/SessionStart.md"
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

@test "PreCompact is an mcp_tool hook calling hook_precompact on the cave-context server" {
  run jq -e '.hooks.PreCompact[0].hooks[0].type == "mcp_tool"' "$HOOKS"
  assert_success
  run jq -e '.hooks.PreCompact[0].hooks[0].server == "plugin:cave-context:cave-context"' "$HOOKS"
  assert_success
  run jq -e '.hooks.PreCompact[0].hooks[0].tool == "hook_precompact"' "$HOOKS"
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

@test "SessionStart is a command hook (PreCompact is now mcp_tool)" {
  run jq -e '.hooks.SessionStart[0].hooks[0].type == "command"' "$HOOKS"
  assert_success
  run jq -e '.hooks.PreCompact[0].hooks[0].type == "command"' "$HOOKS"
  assert_failure
}

@test "no command hook command starts with 'node '" {
  run jq -e '[.hooks | to_entries[].value[].hooks[] | select(.type=="command") | .command] | all(startswith("node ") | not)' "$HOOKS"
  assert_success
}

@test "referenced command-hook files exist and are executable" {
  for f in sessionstart.mjs; do
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

@test "node unit tests pass" {
  run node --test "$REPO_ROOT/test/cave-context/"*.test.mjs
  assert_success
}

@test "cave-compress SKILL.md exists with required frontmatter and is model-invocable" {
  SKILL="$REPO_ROOT/plugins/cave-context/skills/cave-compress/SKILL.md"
  [ -f "$SKILL" ]
  run grep -qxE 'name: cave-compress' "$SKILL"
  assert_success
  # Model-invocable by design: the skill must NOT disable model invocation.
  run grep -q 'disable-model-invocation' "$SKILL"
  assert_failure
}

@test "cave-compress grants required allowed-tools (AskUserQuestion + Bash git)" {
  SKILL="$REPO_ROOT/plugins/cave-context/skills/cave-compress/SKILL.md"
  # AskUserQuestion (confirmation gate) and Bash(git:*) (recoverability) must be granted.
  run grep -q 'AskUserQuestion' "$SKILL"
  assert_success
  run grep -q 'Bash(git:\*)' "$SKILL"
  assert_success
}

@test "SessionStart.md exists and is non-empty" {
  [ -s "$SS_MD" ]
}

@test "SessionStart.md carries the caveman ruleset marker (Part 1)" {
  run grep -q "CAVE-CONTEXT MODE ACTIVE" "$SS_MD"
  assert_success
}

@test "SessionStart.md states the WebFetch -> ctx_fetch_and_index routing rule" {
  run grep -q "WebFetch" "$SS_MD"
  assert_success
  run grep -q "ctx_fetch_and_index" "$SS_MD"
  assert_success
}

@test "SessionStart.md uses bare ctx_ tool names (Part 2 routing present)" {
  run grep -qE "ctx_(execute|search|batch_execute|fetch_and_index)" "$SS_MD"
  assert_success
}

@test "SessionStart.md omits denied tools and namespaced ctx_ prefix" {
  run grep -qE "ctx_stats|ctx_doctor|ctx_upgrade" "$SS_MD"
  assert_failure
  run grep -q "mcp__plugin_cave-context" "$SS_MD"
  assert_failure
}

@test "SessionStart has two command-hook entries" {
  run jq -e '.hooks.SessionStart | length == 2' "$HOOKS"
  assert_success
}

@test "second SessionStart hook cats SessionStart.md via exec-form cat" {
  run jq -e '.hooks.SessionStart[1].hooks[0].type == "command"' "$HOOKS"
  assert_success
  run jq -e '.hooks.SessionStart[1].hooks[0].command == "cat"' "$HOOKS"
  assert_success
  run jq -e '.hooks.SessionStart[1].hooks[0].args[0] | endswith("hooks/SessionStart.md")' "$HOOKS"
  assert_success
}

@test "first SessionStart hook is still the bnx.sh/sessionstart.mjs launcher (unchanged)" {
  cmd="$(jq -r '.hooks.SessionStart[0].hooks[0].command' "$HOOKS")"
  [[ "$cmd" == *bin/bnx.sh ]]
  run jq -e '.hooks.SessionStart[0].hooks[0].args[0] | endswith("hooks/sessionstart.mjs")' "$HOOKS"
  assert_success
}

@test "SessionStart.md Part 1 stays byte-identical to rulesetText()" {
  # Drift guard: Part 1 (everything before the "# Context routing" heading) is an
  # intentional static duplicate of caveman.mjs rulesetText(). A rulesetText()
  # change must be mirrored here, or this test fails. Command substitution strips
  # trailing newlines from both sides, so they differ only by a trailing newline.
  rt="$(node --input-type=module -e 'import("'"$REPO_ROOT"'/plugins/cave-context/mcp/caveman.mjs").then(m=>process.stdout.write(m.rulesetText()))')"
  part1="$(awk '/^# Context routing/{exit} {print}' "$SS_MD" | sed -e :a -e '/^[[:space:]]*$/{$d;N;ba}')"
  [ "$part1" = "$rt" ]
}

