#!/usr/bin/env bats

# .html/.htm through format_pre and the bundled prettier's own HTML printer (there is no prettier
# CLI and no npx path left to reach).

load 'test_helper'

setup() {
  common_setup
}

@test "html: format_pre formats an .html file with the bundled prettier" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.html" '<div>   <p>hi</p>   </div>' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "<div><p>hi</p></div>\n"'
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse"'
  echo "$output" | jq -e '.hookSpecificOutput | has("permissionDecision") | not'
}

@test "html: format_pre formats an .htm file too (.htm alias)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.htm" '<div>   <p>hi</p>   </div>' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "<div><p>hi</p></div>\n"'
}

@test "html: prettier and npx stubs on PATH are never run; the bundled prettier formats in-process" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  rec_stub prettier
  rec_stub npx
  run pre_tool_use_write_call "$cwd/a.html" '<div>   <p>hi</p>   </div>' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "<div><p>hi</p></div>\n"'
  [ ! -s "$RECORD" ]
}
