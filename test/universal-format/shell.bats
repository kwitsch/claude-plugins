#!/usr/bin/env bats

# .sh/.bash through format_pre and the bundled prettier-plugin-sh. The shfmt CLI chain is gone:
# the last test is the tripwire that it really never runs.

load 'test_helper'

setup() {
  common_setup
}

@test "shell: format_pre formats a .sh file with the bundled prettier" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.sh" 'echo  hi' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "echo hi\n"'
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse"'
  echo "$output" | jq -e '.hookSpecificOutput | has("permissionDecision") | not'
}

@test "shell: format_pre formats a .bash file too" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.bash" 'echo  hi' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "echo hi\n"'
}

@test "shell: a shfmt stub on PATH is never run; the bundled plugin formats in-process" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  rec_stub shfmt
  run pre_tool_use_write_call "$cwd/a.sh" 'echo  hi' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "echo hi\n"'
  [ ! -s "$RECORD" ]
}
