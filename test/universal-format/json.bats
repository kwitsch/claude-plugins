#!/usr/bin/env bats

# prettier for .json.

load 'test_helper'

setup() {
  common_setup
}

@test "formats a json file: prettier runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"a":1}' > "$cwd/a.json"
  rec_stub prettier
  run format_file_call "$cwd/a.json" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.json")'
  run rg_or_grep -E "^prettier " "$RECORD"
  assert_success
}

@test "json: no project prettier config -> --print-width override in recorded argv" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"a":1}' > "$cwd/a.json"
  rec_stub prettier
  run format_file_call "$cwd/a.json" "$cwd"
  assert_success
  run rg_or_grep -F -- "--print-width 99999" "$RECORD"
  assert_success
}

@test "json: top-level \"prettier\" key in package.json -> no --print-width override" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"a":1}' > "$cwd/a.json"
  printf '{"prettier": {"printWidth": 100}}' > "$cwd/package.json"
  rec_stub prettier
  run format_file_call "$cwd/a.json" "$cwd"
  assert_success
  run rg_or_grep -F -- "--print-width" "$RECORD"
  assert_failure
}

