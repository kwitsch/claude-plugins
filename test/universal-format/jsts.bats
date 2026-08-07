#!/usr/bin/env bats

# prettier chain, npx fallback.

load 'test_helper'

setup() {
  common_setup
}

@test "jsts: prettier absent but npx present -> npx --yes prettier fallback runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  rec_stub npx
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.js")'
  run rg_or_grep -F "npx --yes prettier" "$RECORD"
  assert_success
  run cat "$cwd/a.js"
  assert_output --partial "reformatted-by-npx"
}

@test "jsts: prettier present on PATH -> npx never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  rec_stub prettier
  rec_stub npx   # present but must not be used
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  run rg_or_grep -E "^prettier " "$RECORD"
  assert_success
  run rg_or_grep -F "npx" "$RECORD"
  assert_failure
}

@test "jsts: prettier absent, npx also absent -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

