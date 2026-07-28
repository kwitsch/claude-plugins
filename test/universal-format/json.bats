#!/usr/bin/env bats

# prettier/biome for .json.

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

@test "json: biome.json present, prettier absent -> biome runs bare" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"a":1}' > "$cwd/a.json"
  printf '{}\n' > "$cwd/biome.json"
  printf 'root = true\n[*]\nindent_style = space\nindent_size = 2\n' > "$cwd/.editorconfig"
  rec_stub biome
  run format_file_call "$cwd/a.json" "$cwd"
  assert_success
  run rg_or_grep -F -- "--indent-style" "$RECORD"
  assert_failure
  run rg_or_grep -F "biome " "$RECORD"
  assert_success
}

