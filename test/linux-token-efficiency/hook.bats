#!/usr/bin/env bats

# hooks/rtk-rewrite.mjs — PreToolUse Bash router hook (context-mode steer branch +
# rtk rewrite branch), linux-token-efficiency.
#
# The hook resolves its bundled binary as <script dir>/../bin/rtk, so behavior tests
# run a COPY of the hook inside a fake plugin tree in $BATS_TEST_TMPDIR whose bin/
# holds a stub `rtk`. That bin/ is also placed on the test PATH, standing in for the
# plugin loader's own PATH injection.

load 'test_helper'

setup() {
  common_setup
  FAKE_PLUGIN="$BATS_TEST_TMPDIR/plugin"
  PLUGIN_BIN="$FAKE_PLUGIN/bin"
  GLOBAL_BIN="$BATS_TEST_TMPDIR/globalbin"
  mkdir -p "$FAKE_PLUGIN/hooks" "$PLUGIN_BIN" "$GLOBAL_BIN"
  FAKE_HOOK="$FAKE_PLUGIN/hooks/rtk-rewrite.mjs"
  cp "$HOOK" "$FAKE_HOOK"
  chmod +x "$FAKE_HOOK"
  REWRITE_JSON='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecisionReason":"RTK auto-rewrite","updatedInput":{"command":"rtk ls -la /tmp","description":"list"}}}'
}

# rtk_stub <dir> <body-line>... -- an `rtk` stub that always drains stdin first.
rtk_stub() {
  local dir="$1"
  shift
  make_stub_in "$dir" rtk 'cat > /dev/null' "$@"
}

# hook_run <payload> [VAR=VALUE ...] -- pipe a payload into the fake hook on an
# isolated PATH (plugin bin first, then MOCKBIN). env -i wipes BATS_TEST_TMPDIR, so
# TMPDIR is forwarded explicitly for any stub that needs a temp dir.
hook_run() {
  local payload="$1"
  shift
  run env -i PATH="$PLUGIN_BIN:$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" "$@" "$FAKE_HOOK" <<< "$payload"
}

# hook_run_path <payload> <path> [VAR=VALUE ...] -- same, with an explicit PATH.
hook_run_path() {
  local payload="$1" pathval="$2"
  shift 2
  run env -i PATH="$pathval" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" "$@" "$FAKE_HOOK" <<< "$payload"
}

# assert_json <jq-filter> -- assert the last run's stdout satisfies the filter.
assert_json() {
  local filter="$1" out="$output"
  run jq -e "$filter" <<< "$out"
  assert_success
}

@test "happy path: rtk's rewritten command is forwarded verbatim" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'ls -la /tmp' '{"description":"list"}')"
  assert_success
  assert_json '.hookSpecificOutput.updatedInput.command == "rtk ls -la /tmp"'
}

@test "emitted command carries no PATH prefix and no absolute path" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'ls -la /tmp' '{"description":"list"}')"
  assert_success
  assert_json '.hookSpecificOutput.updatedInput.command | startswith("rtk ") and (contains("export PATH=") | not) and (contains("/bin/rtk") | not)'
}

@test "emitted hookEventName and reason are the plugin's own" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'ls -la /tmp' '{"description":"list"}')"
  assert_json '.hookSpecificOutput.hookEventName == "PreToolUse" and .hookSpecificOutput.permissionDecisionReason == "rtk auto-rewrite (bundled)"'
}

@test "emitted JSON never contains permissionDecision" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'ls -la /tmp' '{"description":"list"}')"
  assert_json '.hookSpecificOutput | has("permissionDecision") | not'
}

@test "every original tool_input field survives; only command changes" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'ls -la /tmp' '{"description":"list","timeout":600000,"run_in_background":true,"future_field":"keep-me"}')"
  assert_success
  assert_json '.hookSpecificOutput.updatedInput | .run_in_background == true and .timeout == 600000 and .description == "list" and .future_field == "keep-me" and .command == "rtk ls -la /tmp"'
}

@test "rtk returning the command unchanged produces no output" {
  local same='{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"ls -la /tmp"}}}'
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$same'"
  hook_run "$(make_input 'ls -la /tmp')"
  assert_success
  assert_output ''
}

@test "rtk printing nothing produces no output" {
  rtk_stub "$PLUGIN_BIN" 'exit 0'
  hook_run "$(make_input 'echo hi')"
  assert_success
  assert_output ''
}

@test "rtk exiting non-zero produces no output" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'" 'exit 1'
  hook_run "$(make_input 'ls -la /tmp')"
  assert_success
  assert_output ''
}

@test "rtk printing garbage produces no output" {
  rtk_stub "$PLUGIN_BIN" 'printf "not json at all\n"'
  hook_run "$(make_input 'ls -la /tmp')"
  assert_success
  assert_output ''
}

@test "rtk hanging past the internal timeout produces no output" {
  rtk_stub "$PLUGIN_BIN" 'sleep 8' "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'ls -la /tmp')"
  assert_success
  assert_output ''
}

@test "a non-updatedInput decision shape produces no output (fail-open, never forwards permissionDecision)" {
  local other='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"blocked by rtk"}}'
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$other'"
  hook_run "$(make_input 'rm -rf /')"
  assert_success
  assert_output ''
}

@test "missing bundled binary produces no output" {
  rm -f "$PLUGIN_BIN/rtk"
  rtk_stub "$GLOBAL_BIN"
  hook_run_path "$(make_input 'ls -la /tmp')" "$GLOBAL_BIN:$MOCKBIN"
  assert_success
  assert_output ''
}

@test "non-executable bundled binary produces no output" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  chmod -x "$PLUGIN_BIN/rtk"
  hook_run "$(make_input 'ls -la /tmp')"
  assert_success
  assert_output ''
}

@test "rtk not resolvable on PATH at all produces no output" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run_path "$(make_input 'ls -la /tmp')" "$MOCKBIN"
  assert_success
  assert_output ''
}

@test "a global rtk earlier on PATH produces no output" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  rtk_stub "$GLOBAL_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run_path "$(make_input 'ls -la /tmp')" "$GLOBAL_BIN:$PLUGIN_BIN:$MOCKBIN"
  assert_success
  assert_output ''
}

@test "a non-Bash tool_name produces no output" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(jq -cn '{hook_event_name:"PreToolUse", tool_name:"Write", tool_input:{file_path:"/tmp/x"}}')"
  assert_success
  assert_output ''
}

@test "an empty command produces no output" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input '')"
  assert_success
  assert_output ''
}

@test "malformed stdin JSON produces no output" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run 'this is not json'
  assert_success
  assert_output ''
}

@test "toggle: CLAUDE_PLUGIN_OPTION_AUTO_REWRITE=false disables the rewrite" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'ls -la /tmp')" CLAUDE_PLUGIN_OPTION_AUTO_REWRITE=false
  assert_success
  assert_output ''
}

@test "toggle: unset, empty, true and an uninterpolated placeholder all stay enabled" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'ls -la /tmp')"
  assert_json '.hookSpecificOutput.updatedInput.command == "rtk ls -la /tmp"'
  hook_run "$(make_input 'ls -la /tmp')" CLAUDE_PLUGIN_OPTION_AUTO_REWRITE=
  assert_json '.hookSpecificOutput.updatedInput.command == "rtk ls -la /tmp"'
  hook_run "$(make_input 'ls -la /tmp')" CLAUDE_PLUGIN_OPTION_AUTO_REWRITE=true
  assert_json '.hookSpecificOutput.updatedInput.command == "rtk ls -la /tmp"'
  hook_run "$(make_input 'ls -la /tmp')" 'CLAUDE_PLUGIN_OPTION_AUTO_REWRITE=${user_config.auto_rewrite}'
  assert_json '.hookSpecificOutput.updatedInput.command == "rtk ls -la /tmp"'
}

# --- steer branch (context-mode): deny-steers read-only gather commands; everything
# --- else falls through to the rtk rewrite branch below. Classifier internals are
# --- unit-tested in rtk-rewrite.test.mjs; these cases pin the end-to-end routing.

@test "steer: a read-only 3-segment chain is denied toward ctx_batch_execute, rtk never consulted" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'grep -rn foo src && wc -l file && cat README.md')"
  assert_success
  # One combined filter: assert_json consumes $output, so it must not be chained.
  assert_json '.hookSpecificOutput | (.permissionDecision == "deny") and (has("updatedInput") | not) and (.permissionDecisionReason | contains("ctx_batch_execute") and contains("grep -rn foo src") and contains("Do not retry") and contains("steer_enabled"))'
}

@test "steer: a bare curl GET is denied toward ctx_fetch_and_index" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'curl -sSL https://example.com/api/items')"
  assert_success
  assert_json '.hookSpecificOutput | (.permissionDecision == "deny") and (.permissionDecisionReason | contains("ctx_fetch_and_index") and contains("https://example.com/api/items"))'
}

@test "steer: a read-only 3-stage pipeline is denied toward ctx_execute" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'cat log.txt | grep ERROR | sort | uniq -c')"
  assert_success
  assert_json '.hookSpecificOutput | (.permissionDecision == "deny") and (.permissionDecisionReason | contains("ctx_execute") and contains("\"language\": \"shell\""))'
}

@test "steer: git/gh chains stay in Bash and get the rtk rewrite instead" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'git status && git log --oneline -5 && git diff' '{"description":"list"}')"
  assert_success
  assert_json '.hookSpecificOutput | (.updatedInput.command == "rtk ls -la /tmp") and (has("permissionDecision") | not)'
}

@test "steer: a backgrounded gather command is never steered (ctx tools cannot background)" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'grep -rn foo src && wc -l file && cat README.md' '{"run_in_background":true}')"
  assert_success
  assert_json '.hookSpecificOutput | (has("permissionDecision") | not) and (.updatedInput.command == "rtk ls -la /tmp")'
}

@test "steer toggle: CLAUDE_PLUGIN_OPTION_STEER_ENABLED=false disables the steer, rewrite still runs" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'grep -rn foo src && wc -l file && cat README.md')" CLAUDE_PLUGIN_OPTION_STEER_ENABLED=false
  assert_success
  assert_json '.hookSpecificOutput | (has("permissionDecision") | not) and (.updatedInput.command == "rtk ls -la /tmp")'
}

@test "steer runs independently of auto_rewrite: both toggles off produce no output" {
  rtk_stub "$PLUGIN_BIN" "printf '%s\n' '$REWRITE_JSON'"
  hook_run "$(make_input 'grep -rn foo src && wc -l file && cat README.md')" CLAUDE_PLUGIN_OPTION_AUTO_REWRITE=false
  assert_success
  assert_json '.hookSpecificOutput.permissionDecision == "deny"'
  hook_run "$(make_input 'grep -rn foo src && wc -l file && cat README.md')" \
    CLAUDE_PLUGIN_OPTION_AUTO_REWRITE=false CLAUDE_PLUGIN_OPTION_STEER_ENABLED=false
  assert_success
  assert_output ''
}

@test "hooks.json wires PreToolUse/Bash to the hook with no node prefix" {
  run jq -e '.hooks.PreToolUse[0].matcher == "Bash"' "$HOOKS"
  assert_success
  run jq -e '.hooks.PreToolUse[0].hooks[0].type == "command" and .hooks.PreToolUse[0].hooks[0].command == "${CLAUDE_PLUGIN_ROOT}/hooks/rtk-rewrite.mjs" and .hooks.PreToolUse[0].hooks[0].timeout == 10' "$HOOKS"
  assert_success
  run jq -e '.hooks.PreToolUse[0].hooks[0] | has("async") | not' "$HOOKS"
  assert_success
}

@test "hooks.json contains no user_config placeholder" {
  run grep -F 'user_config' "$HOOKS"
  assert_failure
}

@test "rtk-rewrite.mjs is executable in the git index (100755)" {
  # Index, not HEAD: this suite runs before the adding commit exists.
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/hooks/rtk-rewrite.mjs
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/hooks/rtk-rewrite\.mjs$'
}
