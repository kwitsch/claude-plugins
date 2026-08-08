#!/usr/bin/env bats

# .html/.htm through format_pre and the bundled prettier's own HTML printer; format_post owns
# neither (there is no prettier CLI and no npx path left to reach).

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

@test "html: format_post returns {} with prettier and npx stubs present but never run" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '<div><p>hi</p></div>\n' > "$cwd/a.html"
  rec_stub prettier
  rec_stub npx
  run format_file_call "$cwd/a.html" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}
