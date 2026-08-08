#!/usr/bin/env bats

# .css/.scss through format_pre and the bundled prettier; format_post owns neither.

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
@test "scss: format_post returns {} with prettier and npx stubs present but never run" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '.a{color:red}\n' > "$cwd/a.scss"
  rec_stub prettier
  rec_stub npx
  run format_file_call "$cwd/a.scss" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}
