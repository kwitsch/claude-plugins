#!/usr/bin/env bats

# .css/.scss/.less through format_pre and the bundled prettier; no CLI is ever involved.

load 'test_helper'

setup() {
  common_setup
}

@test "css: format_pre formats a css file with the bundled prettier" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.css" '.a{color:red}
' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == ".a {\n  color: red;\n}\n"'
}

@test "scss: format_pre formats a scss file with the bundled prettier" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.scss" '.a{color:red}
' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == ".a {\n  color: red;\n}\n"'
}

# Replaces the old "scss: prettier absent -> npx --yes prettier fallback runs" test with its
# inverse: there is no subprocess prettier path left to reach, from PATH or via npx.
@test "scss: prettier and npx stubs on PATH are never run; the bundled prettier formats in-process" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  rec_stub prettier
  rec_stub npx
  run pre_tool_use_write_call "$cwd/a.scss" '.a{color:red}
' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == ".a {\n  color: red;\n}\n"'
  [ ! -s "$RECORD" ]
}

@test "less: format_pre formats a .less file with the bundled prettier" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.less" '@c:  red;
.a{color:@c}
' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "@c: red;\n.a {\n  color: @c;\n}\n"'
}
