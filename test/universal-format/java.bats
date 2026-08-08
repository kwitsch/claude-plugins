#!/usr/bin/env bats

# .java through format_pre and the bundled prettier-plugin-java — which also proves the two
# committed .wasm sidecars load from their committed location. The google-java-format/clang-format
# chain and its .editorconfig mappers are gone; the last test is the tripwire.

load 'test_helper'

setup() {
  common_setup
}

@test "java: format_pre formats a .java file with the bundled prettier (wasm sidecars load)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/A.java" 'class A {  }' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "class A {}\n"'
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse"'
}

@test "java: format_post returns {} with google-java-format and clang-format stubs present but never run" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  rec_stub google-java-format
  rec_stub clang-format
  run format_file_call "$cwd/A.java" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}
