#!/usr/bin/env bats

# prettier for .css/.scss.

load 'test_helper'

setup() {
  common_setup
}

@test "formats a css file: prettier runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '.a{color:red}\n' > "$cwd/a.css"
  rec_stub prettier
  run format_file_call "$cwd/a.css" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.css")'
}

@test "formats a scss file: prettier runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '.a{color:red}\n' > "$cwd/a.scss"
  rec_stub prettier
  run format_file_call "$cwd/a.scss" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.scss")'
}

@test "scss: prettier absent -> npx --yes prettier fallback runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '.a{color:red}\n' > "$cwd/a.scss"
  rec_stub npx
  run format_file_call "$cwd/a.scss" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.scss")'
  run rg_or_grep -F "npx --yes prettier" "$RECORD"
  assert_success
}
