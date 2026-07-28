#!/usr/bin/env bats

# google-java-format/clang-format .editorconfig mapping.

load 'test_helper'

setup() {
  common_setup
}

@test "java .editorconfig indent_size=4 -> google-java-format gets --aosp" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  printf 'root = true\n[*.java]\nindent_size = 4\n' > "$cwd/.editorconfig"
  rec_stub google-java-format
  run format_file_call "$cwd/A.java" "$cwd"
  assert_success
  run rg_or_grep -F -- "--aosp" "$RECORD"
  assert_success
}

@test "java .editorconfig indent_size=2 -> google-java-format runs bare (no --aosp)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  printf 'root = true\n[*.java]\nindent_size = 2\n' > "$cwd/.editorconfig"
  rec_stub google-java-format
  run format_file_call "$cwd/A.java" "$cwd"
  assert_success
  run rg_or_grep -F -- "--aosp" "$RECORD"
  assert_failure
  run rg_or_grep -F -- "--replace" "$RECORD"
  assert_success
}

@test "java .editorconfig indent_style=tab -> hard conflict, formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  printf 'root = true\n[*]\nindent_style = tab\n' > "$cwd/.editorconfig"
  rec_stub google-java-format
  run format_file_call "$cwd/A.java" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "java .editorconfig indent_style=tab -> google-java-format skips, clang-format fallback runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  printf 'root = true\n[*]\nindent_style = tab\n' > "$cwd/.editorconfig"
  rec_stub google-java-format
  rec_stub clang-format
  run format_file_call "$cwd/A.java" "$cwd"
  assert_success
  local result="$output"
  run rg_or_grep -F "google-java-format " "$RECORD"
  assert_failure
  run rg_or_grep -F "clang-format " "$RECORD"
  assert_success
  echo "$result" | jq -e '.hookSpecificOutput.additionalContext | test("clang-format reformatted A.java")'
}

