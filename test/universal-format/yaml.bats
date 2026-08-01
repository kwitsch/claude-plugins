#!/usr/bin/env bats

# prettier for .yaml/.yml.

load 'test_helper'

setup() {
  common_setup
}

@test "formats a yaml file: prettier runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a: 1\n' > "$cwd/a.yaml"
  rec_stub prettier
  run format_file_call "$cwd/a.yaml" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.yaml")'
}

@test "formats a yml file: prettier runs (.yml extension)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a: 1\n' > "$cwd/a.yml"
  rec_stub prettier
  run format_file_call "$cwd/a.yml" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.yml")'
}

@test "yaml: no project prettier config -> --print-width override in recorded argv" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a: 1\n' > "$cwd/a.yaml"
  rec_stub prettier
  run format_file_call "$cwd/a.yaml" "$cwd"
  assert_success
  run rg_or_grep -F -- "--print-width 99999" "$RECORD"
  assert_success
}

@test "yaml: project .prettierrc present -> no --print-width override" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a: 1\n' > "$cwd/a.yaml"
  printf '{}\n' > "$cwd/.prettierrc"
  rec_stub prettier
  run format_file_call "$cwd/a.yaml" "$cwd"
  assert_success
  run rg_or_grep -F -- "--print-width" "$RECORD"
  assert_failure
}

@test "yaml: .editorconfig sets max_line_length -> no --print-width override (prettier honors it natively)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a: 1\n' > "$cwd/a.yaml"
  printf 'root = true\n[*]\nmax_line_length = 120\n' > "$cwd/.editorconfig"
  rec_stub prettier
  run format_file_call "$cwd/a.yaml" "$cwd"
  assert_success
  run rg_or_grep -F -- "--print-width" "$RECORD"
  assert_failure
}

