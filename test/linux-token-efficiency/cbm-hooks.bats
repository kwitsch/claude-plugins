#!/usr/bin/env bats

# The four context-only cbm hooks, exercised as real tools/call requests against the proxy
# server in a fixture plugin tree (the old command-hook stdin harness is gone with the
# command hooks). The child is the fake cbm binary; payloads are the shapes recorded from
# the pinned v0.10.1 binary.

load 'test_helper'

setup() {
  common_setup
  make_cbm_server_fixture "$BATS_TEST_TMPDIR/plugin"
  warm_cbm_cache
  WORKDIR="$BATS_TEST_TMPDIR/repo/app"
  mkdir -p "$WORKDIR/src"
  cbm_payloads "$WORKDIR" gap
}

teardown() {
  stop_release_server
}

# cbm_payloads <project-root> <gap|unavailable|clean> -- canned cbm payloads for the fake
# binary, in the shapes the real v0.10.1 binary returns.
cbm_payloads() {
  local root="$1" coverage="$2"
  local coverage_json
  case "$coverage" in
    gap)
      coverage_json='{"project":"app","signal":"ok","paths":[{"requested_path":"src/server.mjs","path":"src/server.mjs","coverage_lookup":"ok","status":"not_indexed","freshness":"unknown","recommended_action":"reindex","coverage":[]}]}'
      ;;
    unavailable)
      coverage_json='{"project":"app","paths":[{"requested_path":"src/server.mjs","path":"src/server.mjs","coverage_lookup":"error","status":"coverage_unavailable"}]}'
      ;;
    *)
      coverage_json='{"project":"app","paths":[{"requested_path":"src/server.mjs","path":"src/server.mjs","coverage_lookup":"ok","status":"indexed","freshness":"current","recommended_action":"none","coverage":[]}]}'
      ;;
  esac
  set_fake_payloads "$(jq -cn --arg root "$root" --argjson cov "$coverage_json" \
    '{list_projects:{projects:[{name:"app",path:$root}]},
      index_status:{status:"ready",files:42},
      search_graph:{total:1,count:1,cols:["name","label","lines","in","out"],
                    groups:[{qn_prefix:"app.",file:"src/server.mjs",rows:[["handleRequest","function","12-40",1,2]]}],
                    has_more:false},
      check_index_coverage:$cov}')"
}

hook_result() {
  cbm_rpc_result 2
}

@test "hook_session_context emits exactly hookSpecificOutput.{hookEventName,additionalContext}" {
  cbm_call hook_session_context "$(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd}')"
  run jq -e '.structuredContent | keys == ["hookSpecificOutput"] and (.hookSpecificOutput | keys | sort) == ["additionalContext","hookEventName"]' <<< "$(hook_result)"
  assert_success
  run jq -e '.structuredContent.hookSpecificOutput | .hookEventName == "SessionStart" and (.additionalContext | test("app")) and (.additionalContext | test("ready"))' <<< "$(hook_result)"
  assert_success
}

@test "--session-start-hook CLI mode emits the same shape without the JSON-RPC loop" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    CBM_BUNDLE_CACHE="$CBM_CACHE" CBM_DOWNLOAD_BASE_URL="$CBM_DOWNLOAD_BASE_URL" \
    CBM_FAKE_LOG="$FAKE_LOG" CBM_FAKE_PAYLOADS="$FAKE_PAYLOADS" \
    node "$FIXTURE_SERVER" --session-start-hook <<< "$(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd}')"
  assert_success
  local hook_output="$output"
  run jq -e '.hookSpecificOutput | keys | sort == ["additionalContext","hookEventName"]' <<< "$hook_output"
  assert_success
  run jq -e '.hookSpecificOutput | .hookEventName == "SessionStart" and (.additionalContext | test("app")) and (.additionalContext | test("ready"))' <<< "$hook_output"
  assert_success
}

@test "--session-start-hook CLI mode stays silent on a cwd no graph project covers" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    CBM_BUNDLE_CACHE="$CBM_CACHE" CBM_DOWNLOAD_BASE_URL="$CBM_DOWNLOAD_BASE_URL" \
    CBM_FAKE_LOG="$FAKE_LOG" CBM_FAKE_PAYLOADS="$FAKE_PAYLOADS" \
    node "$FIXTURE_SERVER" --session-start-hook <<< '{"cwd":"/nowhere/at/all"}'
  assert_success
  assert_output '{}'
}

@test "hook_subagent_context emits its own hookEventName" {
  cbm_call hook_subagent_context "$(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd}')"
  run jq -e '.structuredContent.hookSpecificOutput | .hookEventName == "SubagentStart" and (.additionalContext | length > 0)' <<< "$(hook_result)"
  assert_success
}

@test "a cwd no graph project covers stays silent" {
  cbm_call hook_session_context '{"cwd":"/nowhere/at/all"}'
  run jq -e '.structuredContent == {}' <<< "$(hook_result)"
  assert_success
}

@test "hook_symbol_context sends name_pattern for Grep and file_pattern for Glob, both format json" {
  cbm_call hook_symbol_context "$(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd, tool_name:"Grep", tool_input:{pattern:"handleRequest"}}')"
  run jq -e '.structuredContent.hookSpecificOutput | .hookEventName == "PreToolUse" and (.additionalContext | test("app.handleRequest")) and (.additionalContext | test("src/server.mjs:12"))' <<< "$(hook_result)"
  assert_success
  run jq -se 'map(select(.name == "search_graph")) | last.arguments | .name_pattern == "handleRequest" and .format == "json" and .limit == 10 and .project == "app" and (has("file_pattern") | not)' "$FAKE_LOG"
  assert_success

  cbm_call hook_symbol_context "$(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd, tool_name:"Glob", tool_input:{pattern:"**/*.mjs"}}')"
  run jq -se 'map(select(.name == "search_graph")) | last.arguments | .file_pattern == "**/*.mjs" and .format == "json" and (has("name_pattern") | not)' "$FAKE_LOG"
  assert_success
}

@test "hook_coverage_context warns on a real gap and passes a project-relative paths array" {
  cbm_call hook_coverage_context "$(jq -cn --arg cwd "$WORKDIR" --arg fp "$WORKDIR/src/server.mjs" '{cwd:$cwd, tool_input:{file_path:$fp}}')"
  run jq -e '.structuredContent.hookSpecificOutput | .hookEventName == "PostToolUse" and (.additionalContext | test("coverage warning")) and (.additionalContext | test("not_indexed"))' <<< "$(hook_result)"
  assert_success
  run jq -se 'map(select(.name == "check_index_coverage")) | last.arguments | .paths == ["src/server.mjs"] and .project == "app" and (has("path") | not)' "$FAKE_LOG"
  assert_success
}

@test "hook_coverage_context is silent on coverage_unavailable and on a clean report" {
  cbm_payloads "$WORKDIR" unavailable
  cbm_call hook_coverage_context "$(jq -cn --arg cwd "$WORKDIR" --arg fp "$WORKDIR/src/server.mjs" '{cwd:$cwd, tool_input:{file_path:$fp}}')"
  run jq -e '.structuredContent == {}' <<< "$(hook_result)"
  assert_success

  cbm_payloads "$WORKDIR" clean
  cbm_call hook_coverage_context "$(jq -cn --arg cwd "$WORKDIR" --arg fp "$WORKDIR/src/server.mjs" '{cwd:$cwd, tool_input:{file_path:$fp}}')"
  run jq -e '.structuredContent == {}' <<< "$(hook_result)"
  assert_success
}

@test "a file outside the project root never reaches check_index_coverage" {
  cbm_call hook_coverage_context "$(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd, tool_input:{file_path:"/etc/hosts"}}')"
  run jq -e '.structuredContent == {}' <<< "$(hook_result)"
  assert_success
  run bash -c "grep -c '\"name\":\"check_index_coverage\"' '$FAKE_LOG' || true"
  assert_output '0'
}

@test "no hook response ever carries a decision, permission or rewrite field" {
  for tool_args in \
    "hook_session_context $(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd}')" \
    "hook_subagent_context $(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd}')" \
    "hook_symbol_context $(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd, tool_name:"Grep", tool_input:{pattern:"handleRequest"}}')" \
    "hook_coverage_context $(jq -cn --arg cwd "$WORKDIR" --arg fp "$WORKDIR/src/server.mjs" '{cwd:$cwd, tool_input:{file_path:$fp}}')"; do
    # shellcheck disable=SC2086
    cbm_call ${tool_args}
    run jq -e '.structuredContent | ((has("decision") or has("continue") or has("stopReason") or has("updatedInput") or has("updatedToolOutput")) | not) and ((.hookSpecificOutput // {}) | (has("permissionDecision") or has("updatedInput") or has("updatedToolOutput")) | not)' <<< "$(hook_result)"
    assert_success
    run jq -e '.isError == null or .isError == false' <<< "$(hook_result)"
    assert_success
  done
}

@test "malformed arguments yield silence without calling cbm" {
  for args in '{}' '{"cwd":""}' '{"cwd":"${cwd}"}' '{"cwd":12}'; do
    cbm_call hook_session_context "$args"
    run jq -e '.structuredContent == {}' <<< "$(hook_result)"
    assert_success
  done
  cbm_call hook_symbol_context "$(jq -cn --arg cwd "$WORKDIR" --arg pat "$(printf 'x%.0s' {1..201})" '{cwd:$cwd, tool_name:"Grep", tool_input:{pattern:$pat}}')"
  run jq -e '.structuredContent == {}' <<< "$(hook_result)"
  assert_success
  cbm_call hook_symbol_context "$(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd, tool_name:"Read", tool_input:{pattern:"x"}}')"
  run jq -e '.structuredContent == {}' <<< "$(hook_result)"
  assert_success
  run bash -c "grep -c . '$FAKE_LOG' || true"
  assert_output '0'
}

@test "the resolved project is cached per cwd: a second call skips list_projects, a new cwd does not" {
  cbm_call hook_session_context "$(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd}')"
  run bash -c "grep -c '\"name\":\"list_projects\"' '$FAKE_LOG'"
  assert_output '1'

  cbm_call hook_symbol_context "$(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd, tool_name:"Grep", tool_input:{pattern:"handleRequest"}}')"
  run jq -e '.structuredContent.hookSpecificOutput.additionalContext | test("app.handleRequest")' <<< "$(hook_result)"
  assert_success
  run bash -c "grep -c '\"name\":\"list_projects\"' '$FAKE_LOG'"
  assert_output '1' # still 1 — the on-disk per-cwd cache was reused

  local other="$BATS_TEST_TMPDIR/repo/other"
  mkdir -p "$other"
  cbm_call hook_session_context "$(jq -cn --arg cwd "$other" '{cwd:$cwd}')"
  run jq -e '.structuredContent == {}' <<< "$(hook_result)"
  assert_success
  run bash -c "grep -c '\"name\":\"list_projects\"' '$FAKE_LOG'"
  assert_output '2'
}

@test "cbm_enabled=false silences all four hook tools" {
  CBM_RPC_ENV=(CLAUDE_PLUGIN_OPTION_CBM_ENABLED=false)
  cbm_call hook_session_context "$(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd}')"
  # The process exits at startup, so there is no response at all — and nothing was called.
  run bash -c 'printf "%s\n" "$1" | grep -c "\"id\":2" || true' _ "$CBM_RPC_STDOUT"
  assert_output '0'
  run bash -c "grep -c . '$FAKE_LOG' || true"
  assert_output '0'
}

@test "a not-yet-ready binary yields silence instead of waiting for the download" {
  rm -rf "$CBM_CACHE/${FAKE_BIN_SHA:0:16}" # cold cache, unreachable download base
  cbm_call hook_session_context "$(jq -cn --arg cwd "$WORKDIR" '{cwd:$cwd}')"
  run jq -e '.structuredContent == {}' <<< "$(hook_result)"
  assert_success
  run bash -c "grep -c . '$FAKE_LOG' || true"
  assert_output '0'
}

@test "hooks.json wires SubagentStart/PreToolUse/PostToolUse to mcp_tool on the namespaced server with an explicit input, SessionStart to a command hook" {
  run jq empty "$HOOKS"
  assert_success
  local entries='[.hooks.SubagentStart[0].hooks[0], .hooks.PreToolUse[1].hooks[0], .hooks.PostToolUse[0].hooks[0]]'
  run jq -e "$entries | all(.type == \"mcp_tool\" and .server == \"plugin:linux-token-efficiency:codebase-memory\" and .timeout == 20 and (has(\"command\") | not) and (has(\"async\") | not))" "$HOOKS"
  assert_success
  # Regression pin: an omitted "input" delivers {} instead of the hook JSON.
  run jq -e "$entries | all(has(\"input\") and (.input | type == \"object\") and (.input | length > 0))" "$HOOKS"
  assert_success
  run jq -e "$entries | map(.tool) == [\"hook_subagent_context\",\"hook_symbol_context\",\"hook_coverage_context\"]" "$HOOKS"
  assert_success
  # SessionStart fires before any MCP server connects, so it is a command hook (mcp_tool
  # hard-errors there: "no MCP client context") that invokes server.mjs's own CLI mode.
  run jq -e '.hooks.SessionStart[0].hooks[0] | .type == "command" and .command == "${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs" and .args == ["--session-start-hook"] and .timeout == 20 and .statusMessage == "Checking codebase graph..." and (has("server") | not) and (has("tool") | not) and (has("input") | not) and .async == true and (has("asyncRewake") | not)' "$HOOKS"
  assert_success
  run jq -e '.hooks.SubagentStart[0].hooks[0].input == {cwd:"${cwd}"}' "$HOOKS"
  assert_success
  run jq -e '.hooks.PreToolUse[1] | .matcher == "Grep|Glob" and (.hooks[0].input == {cwd:"${cwd}", tool_name:"${tool_name}", tool_input:{pattern:"${tool_input.pattern}"}})' "$HOOKS"
  assert_success
  run jq -e '.hooks.PostToolUse[0] | .matcher == "Read" and (.hooks[0].input == {cwd:"${cwd}", tool_input:{file_path:"${tool_input.file_path}"}})' "$HOOKS"
  assert_success
  run jq -e '(.hooks.SessionStart | length) == 2 and (.hooks.SubagentStart | length) == 2 and (.hooks.PostToolUse | length) == 1 and (.hooks.PreToolUse | length) == 3' "$HOOKS"
  assert_success
  run jq -e '.hooks.SessionStart[0] | has("matcher") | not' "$HOOKS"
  assert_success
  run jq -e '.hooks.SubagentStart[0] | has("matcher") | not' "$HOOKS"
  assert_success
  run grep -F 'cbm-context.mjs' "$HOOKS"
  assert_failure
  run grep -F 'user_config' "$HOOKS"
  assert_failure
}

@test "the rtk Bash entry stays a command hook, first in PreToolUse" {
  run jq -e '.hooks.PreToolUse[0] | .matcher == "Bash" and (.hooks[0] | .type == "command" and .command == "${CLAUDE_PLUGIN_ROOT}/hooks/rtk-rewrite.mjs" and .timeout == 10)' "$HOOKS"
  assert_success
}
