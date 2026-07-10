#!/usr/bin/env bats

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/memory-enhancement"
  HOOKS="$PLUGIN/hooks/hooks.json"
  STOP_HOOK="$PLUGIN/hooks/flag-dream-due.mjs"
  START_HOOK="$PLUGIN/hooks/check-dream-due.mjs"
  export CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/plugin-data"
  export CLAUDE_PROJECT_DIR="$BATS_TEST_TMPDIR/project"
  mkdir -p "$CLAUDE_PLUGIN_DATA" "$CLAUDE_PROJECT_DIR"
}

@test "plugin.json declares the claude-code-knowledge dependency and auto_dream default true" {
  run jq -e '.dependencies == ["claude-code-knowledge"] and .userConfig.auto_dream.default == true and .userConfig.auto_dream.type == "boolean"' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS"
  assert_success
}

@test "Stop hook is type command and points at flag-dream-due.mjs" {
  run jq -e '.hooks.Stop[0].hooks[0].type == "command" and (.hooks.Stop[0].hooks[0].command | endswith("flag-dream-due.mjs"))' "$HOOKS"
  assert_success
}

@test "SessionStart hook is type command, points at check-dream-due.mjs, and passes auto_dream" {
  run jq -e '.hooks.SessionStart[0].hooks[0].type == "command" and (.hooks.SessionStart[0].hooks[0].command | endswith("check-dream-due.mjs")) and (.hooks.SessionStart[0].hooks[0].args == ["${user_config.auto_dream}"])' "$HOOKS"
  assert_success
}

@test "both hook files are executable with a node shebang" {
  [ -x "$STOP_HOOK" ]
  [ -x "$START_HOOK" ]
  run head -n1 "$STOP_HOOK"
  assert_output '#!/usr/bin/env node'
  run head -n1 "$START_HOOK"
  assert_output '#!/usr/bin/env node'
}

@test "both hook files pass node --check" {
  run node --check "$STOP_HOOK"
  assert_success
  run node --check "$START_HOOK"
  assert_success
}

@test "Stop hook creates the flag file from stdin JSON" {
  run bash -c "echo '{\"session_id\":\"s1\",\"cwd\":\"$CLAUDE_PROJECT_DIR\",\"transcript_path\":\"x\",\"permission_mode\":\"default\",\"hook_event_name\":\"Stop\",\"stop_hook_active\":false,\"last_assistant_message\":\"\",\"background_tasks\":[],\"session_crons\":[]}' | node '$STOP_HOOK'"
  assert_success
  run bash -c "ls '$CLAUDE_PLUGIN_DATA'/dream-due-*.flag"
  assert_success
}

prime_flag() {
  echo '{"session_id":"s1","cwd":"'"$CLAUDE_PROJECT_DIR"'","transcript_path":"x","permission_mode":"default","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"","background_tasks":[],"session_crons":[]}' | node "$STOP_HOOK"
}

@test "SessionStart with auto_dream=true and a due flag emits the nudge and clears the flag" {
  prime_flag
  run bash -c "echo '{\"session_id\":\"s1\",\"cwd\":\"$CLAUDE_PROJECT_DIR\",\"transcript_path\":\"x\",\"permission_mode\":\"default\",\"hook_event_name\":\"SessionStart\"}' | node '$START_HOOK' true"
  assert_success
  assert_output --partial '"additionalContext"'
  run bash -c "ls '$CLAUDE_PLUGIN_DATA'/dream-due-*.flag 2>/dev/null | wc -l"
  assert_output "0"
}

@test "SessionStart with auto_dream=false leaves an existing flag untouched and emits nothing" {
  prime_flag
  run bash -c "echo '{\"session_id\":\"s1\",\"cwd\":\"$CLAUDE_PROJECT_DIR\",\"transcript_path\":\"x\",\"permission_mode\":\"default\",\"hook_event_name\":\"SessionStart\"}' | node '$START_HOOK' false"
  assert_success
  assert_output ""
  run bash -c "ls '$CLAUDE_PLUGIN_DATA'/dream-due-*.flag | wc -l"
  assert_output "1"
}

@test "SessionStart with auto_dream=true and no flag emits nothing" {
  run bash -c "echo '{\"session_id\":\"s1\",\"cwd\":\"$CLAUDE_PROJECT_DIR\",\"transcript_path\":\"x\",\"permission_mode\":\"default\",\"hook_event_name\":\"SessionStart\"}' | node '$START_HOOK' true"
  assert_success
  assert_output ""
}
