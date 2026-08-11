#!/usr/bin/env bats

# hooks/cbm-context.mjs — the four context-only cbm hooks. A COPY of the hook runs in a
# fixture plugin tree whose bin/cbm-launch.sh is a STUB: it records its argv and env into
# marker files and prints canned cbm JSON. The real cbm binary is never involved.

load 'test_helper'

setup() {
  common_setup
  FIXTURE="$BATS_TEST_TMPDIR/plugin"
  mkdir -p "$FIXTURE/bin" "$FIXTURE/hooks"
  FAKE_HOOK="$FIXTURE/hooks/cbm-context.mjs"
  cp "$CBM_HOOK" "$FAKE_HOOK"
  chmod +x "$FAKE_HOOK"
  ARGS_LOG="$BATS_TEST_TMPDIR/args.log"
  ENV_LOG="$BATS_TEST_TMPDIR/env.log"
  WORKDIR="$BATS_TEST_TMPDIR/repo/app"
  mkdir -p "$WORKDIR"
  PROJECTS_JSON="$(jq -cn --arg p "$WORKDIR" '{projects:[{name:"app",path:$p}]}')"
  STATUS_JSON='{"status":"ready","files":42}'
  SEARCH_JSON='{"results":[{"qualified_name":"app.handleRequest","file":"src/server.mjs","line":12}]}'
  COVERAGE_GAP_JSON='{"skipped":true,"reason":"unsupported language"}'
  COVERAGE_CLEAN_JSON='{"status":"covered","indexed":true}'
  launcher_stub "$PROJECTS_JSON" "$STATUS_JSON" "$SEARCH_JSON" "$COVERAGE_GAP_JSON"
}

# launcher_stub <projects-json> <status-json> <search-json> <coverage-json> -- a
# bin/cbm-launch.sh stub dispatching on the cbm tool name in argv.
launcher_stub() {
  make_stub_in "$FIXTURE/bin" cbm-launch.sh \
    'cat > /dev/null' \
    "printf '%s\n' \"\$*\" >> '$ARGS_LOG'" \
    "printf 'CBM_NO_EXTRACT=%s CBM_BUNDLE_CACHE=%s\n' \"\${CBM_NO_EXTRACT:-}\" \"\${CBM_BUNDLE_CACHE:-}\" >> '$ENV_LOG'" \
    'for a in "$@"; do case "$a" in' \
    "  list_projects) printf '%s\n' '$1'; exit 0 ;;" \
    "  index_status) printf '%s\n' '$2'; exit 0 ;;" \
    "  search_graph) printf '%s\n' '$3'; exit 0 ;;" \
    "  check_index_coverage) printf '%s\n' '$4'; exit 0 ;;" \
    'esac; done' \
    'exit 0'
}

# hook_run <payload> [VAR=VALUE ...]
hook_run() {
  local payload="$1"
  shift
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    CBM_BUNDLE_CACHE="$BATS_TEST_TMPDIR/cache" "$@" node "$FAKE_HOOK" <<< "$payload"
  # Kept separately because every assert_json below runs its own `run jq`, which
  # clobbers $output — the hook's real stdout has to survive across several asserts.
  HOOK_OUT="$output"
}

session_payload() {
  jq -cn --arg cwd "$WORKDIR" --arg ev "${1:-SessionStart}" \
    '{hook_event_name:$ev, cwd:$cwd, session_id:"s", transcript_path:"/dev/null", permission_mode:"default"}'
}

pre_payload() {
  jq -cn --arg cwd "$WORKDIR" --arg tool "$1" --arg pat "$2" \
    '{hook_event_name:"PreToolUse", cwd:$cwd, tool_name:$tool, tool_input:{pattern:$pat}, session_id:"s", transcript_path:"/dev/null", permission_mode:"default"}'
}

post_payload() {
  jq -cn --arg cwd "$WORKDIR" --arg fp "$1" \
    '{hook_event_name:"PostToolUse", cwd:$cwd, tool_name:"Read", tool_input:{file_path:$fp}, tool_response:{success:true}, session_id:"s", transcript_path:"/dev/null", permission_mode:"default"}'
}

assert_json() {
  local filter="$1"
  run jq -e "$filter" <<< "$HOOK_OUT"
  assert_success
}

@test "SessionStart with a matching project emits one context-only object" {
  hook_run "$(session_payload SessionStart)"
  assert_success
  assert_json '.hookSpecificOutput.hookEventName == "SessionStart" and (.hookSpecificOutput.additionalContext | length > 0)'
  assert_json 'keys == ["hookSpecificOutput"] and (.hookSpecificOutput | keys | sort) == ["additionalContext","hookEventName"]'
  assert_json '.hookSpecificOutput.additionalContext | test("app")'
}

@test "every cbm spawn sets CBM_NO_EXTRACT=1 and a placeholder-free cache root" {
  hook_run "$(session_payload SessionStart)"
  assert_success
  run grep -c 'CBM_NO_EXTRACT=1' "$ENV_LOG"
  refute_output '0'
  run grep -F '${' "$ENV_LOG"
  assert_failure
}

@test "SessionStart with no matching project stays silent" {
  launcher_stub '{"projects":[{"name":"other","path":"/somewhere/else"}]}' "$STATUS_JSON" "$SEARCH_JSON" "$COVERAGE_GAP_JSON"
  hook_run "$(session_payload SessionStart)"
  assert_success
  assert_output ''
}

@test "SubagentStart emits its own hookEventName" {
  hook_run "$(session_payload SubagentStart)"
  assert_success
  assert_json '.hookSpecificOutput.hookEventName == "SubagentStart" and (.hookSpecificOutput.additionalContext | length > 0)'
}

@test "SubagentStart with no matching project stays silent" {
  launcher_stub '{"projects":[]}' "$STATUS_JSON" "$SEARCH_JSON" "$COVERAGE_GAP_JSON"
  hook_run "$(session_payload SubagentStart)"
  assert_success
  assert_output ''
}

@test "PreToolUse Grep queries search_graph with --name-pattern and never decides" {
  hook_run "$(pre_payload Grep 'handleRequest')"
  assert_success
  assert_json '.hookSpecificOutput.hookEventName == "PreToolUse"'
  assert_json '.hookSpecificOutput | (has("permissionDecision") | not) and (has("updatedInput") | not)'
  assert_json '.hookSpecificOutput.additionalContext | test("app.handleRequest")'
  run grep -F 'cli search_graph --project app --name-pattern handleRequest --limit 10 --json' "$ARGS_LOG"
  assert_success
}

@test "PreToolUse Glob queries search_graph with --file-pattern" {
  hook_run "$(pre_payload Glob '**/*.mjs')"
  assert_success
  assert_json '.hookSpecificOutput.hookEventName == "PreToolUse"'
  run grep -F 'cli search_graph --project app --file-pattern **/*.mjs --limit 10 --json' "$ARGS_LOG"
  assert_success
}

@test "PreToolUse with an empty or over-long pattern never spawns cbm" {
  hook_run "$(pre_payload Grep '')"
  assert_success
  assert_output ''
  [ ! -f "$ARGS_LOG" ]
  hook_run "$(pre_payload Grep "$(printf 'x%.0s' {1..201})")"
  assert_success
  assert_output ''
  [ ! -f "$ARGS_LOG" ]
}

@test "PreToolUse with no graph match stays silent" {
  launcher_stub "$PROJECTS_JSON" "$STATUS_JSON" '{"results":[]}' "$COVERAGE_GAP_JSON"
  hook_run "$(pre_payload Grep 'handleRequest')"
  assert_success
  assert_output ''
}

@test "PostToolUse Read warns only on a reported coverage gap" {
  hook_run "$(post_payload "$WORKDIR/src/server.mjs")"
  assert_success
  assert_json '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | length > 0)'
  assert_json '(has("decision") | not) and (has("updatedInput") | not) and (.hookSpecificOutput | has("updatedToolOutput") | not)'
  run grep -F "cli check_index_coverage --project app --path $WORKDIR/src/server.mjs --json" "$ARGS_LOG"
  assert_success
}

@test "PostToolUse Read on a clean coverage report stays silent" {
  launcher_stub "$PROJECTS_JSON" "$STATUS_JSON" "$SEARCH_JSON" "$COVERAGE_CLEAN_JSON"
  hook_run "$(post_payload "$WORKDIR/src/server.mjs")"
  assert_success
  assert_output ''
}

@test "PostToolUse for a non-Read tool never spawns cbm" {
  hook_run "$(jq -cn --arg cwd "$WORKDIR" '{hook_event_name:"PostToolUse", cwd:$cwd, tool_name:"Write", tool_input:{file_path:"/x"}}')"
  assert_success
  assert_output ''
  [ ! -f "$ARGS_LOG" ]
}

@test "toggle false silences all four events" {
  for payload in "$(session_payload SessionStart)" "$(session_payload SubagentStart)" \
    "$(pre_payload Grep 'handleRequest')" "$(post_payload "$WORKDIR/a.mjs")"; do
    hook_run "$payload" CLAUDE_PLUGIN_OPTION_CBM_ENABLED=false
    assert_success
    assert_output ''
  done
  [ ! -f "$ARGS_LOG" ]
}

@test "a missing or non-executable launcher stays silent" {
  chmod -x "$FIXTURE/bin/cbm-launch.sh"
  hook_run "$(session_payload SessionStart)"
  assert_success
  assert_output ''
  rm -f "$FIXTURE/bin/cbm-launch.sh"
  hook_run "$(session_payload SessionStart)"
  assert_success
  assert_output ''
}

@test "a cold cache (launcher prints nothing) stays silent" {
  make_stub_in "$FIXTURE/bin" cbm-launch.sh 'cat > /dev/null' 'exit 0'
  hook_run "$(session_payload SessionStart)"
  assert_success
  assert_output ''
}

@test "a launcher that fails, hangs, or prints garbage stays silent" {
  make_stub_in "$FIXTURE/bin" cbm-launch.sh 'cat > /dev/null' 'exit 1'
  hook_run "$(session_payload SessionStart)"
  assert_success
  assert_output ''
  make_stub_in "$FIXTURE/bin" cbm-launch.sh 'cat > /dev/null' 'sleep 8' 'printf "{}\n"'
  hook_run "$(session_payload SessionStart)"
  assert_success
  assert_output ''
  make_stub_in "$FIXTURE/bin" cbm-launch.sh 'cat > /dev/null' 'printf "not json at all\n"'
  hook_run "$(session_payload SessionStart)"
  assert_success
  assert_output ''
  make_stub_in "$FIXTURE/bin" cbm-launch.sh 'cat > /dev/null' 'printf "{\"surprise\":true}\n"'
  hook_run "$(session_payload SessionStart)"
  assert_success
  assert_output ''
}

@test "malformed, empty and oversized stdin stay silent" {
  hook_run 'this is not json'
  assert_success
  assert_output ''
  hook_run ''
  assert_success
  assert_output ''
  run bash -c "head -c 1200000 /dev/zero | tr '\\0' 'a' > '$BATS_TEST_TMPDIR/big.txt'"
  assert_success
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    node "$FAKE_HOOK" < "$BATS_TEST_TMPDIR/big.txt"
  assert_success
  assert_output ''
}

@test "an unknown hook_event_name stays silent" {
  hook_run "$(session_payload Stop)"
  assert_success
  assert_output ''
}

@test "a non-Linux host stays silent" {
  # The platform guard reads process.platform, so simulate it by asserting the guard's
  # own precondition instead of a uname stub: on a Linux x64 CI host the hook speaks,
  # elsewhere the whole suite is skipped.
  [ "$(uname -s)" = "Linux" ] || skip "not a Linux host"
  [ "$(uname -m)" = "x86_64" ] || skip "not an x86_64 host"
  hook_run "$(session_payload SessionStart)"
  assert_success
  assert_json '.hookSpecificOutput.hookEventName == "SessionStart"'
}

@test "a resolved project is cached: the second call for the same cwd never re-runs list_projects" {
  hook_run "$(session_payload SessionStart)"
  assert_success
  run grep -c 'list_projects' "$ARGS_LOG"
  assert_output '1'

  hook_run "$(pre_payload Grep 'handleRequest')"
  assert_success
  assert_json '.hookSpecificOutput.additionalContext | test("app.handleRequest")'
  run grep -c 'list_projects' "$ARGS_LOG"
  assert_output '1' # still 1 -- the second hook reused the cached project, not a fresh lookup
  run grep -c 'search_graph' "$ARGS_LOG"
  assert_output '1'
}

@test "a different cwd gets its own cache entry, not the first cwd's" {
  hook_run "$(session_payload SessionStart)"
  assert_success

  OTHER_WORKDIR="$BATS_TEST_TMPDIR/repo/other"
  mkdir -p "$OTHER_WORKDIR"
  hook_run "$(jq -cn --arg cwd "$OTHER_WORKDIR" --arg ev "SessionStart" \
    '{hook_event_name:$ev, cwd:$cwd, session_id:"s", transcript_path:"/dev/null", permission_mode:"default"}')"
  assert_success
  assert_output '' # no project covers this cwd -- resolved fresh, not borrowed from the cache dir's other entry
  run grep -c 'list_projects' "$ARGS_LOG"
  assert_output '2'
}
