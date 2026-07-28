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

