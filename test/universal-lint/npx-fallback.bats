#!/usr/bin/env bats

# eslint npx fallback (present/absent).

load 'test_helper'

setup() {
  common_setup
}

@test "eslint absent but npx present -> npx --yes eslint fallback runs, issues surfaced" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT='a.js: 1:1  error  x is assigned a value but never used  no-unused-vars'
  rec_stub npx 1
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("no-unused-vars")'
  run rg_or_grep -F "npx --yes eslint $cwd/a.js" "$RECORD"
  assert_success
}

@test "eslint present on PATH -> npx never invoked even if present" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT="clean"
  rec_stub eslint 0
  rec_stub npx 0   # present but must not be used
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  run rg_or_grep -E "^eslint " "$RECORD"
  assert_success
  run rg_or_grep -F "npx" "$RECORD"
  assert_failure
}

