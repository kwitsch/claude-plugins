#!/usr/bin/env bats

# stylelint (SCSS/CSS).

load 'test_helper'

setup() {
  common_setup
}

@test "stylelint finds an issue (exit 2): additionalContext returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '.a{color:red}\n' > "$cwd/a.scss"
  OUT='a.scss:1:1: Expected a trailing semicolon (declaration-block-trailing-semicolon)'
  rec_stub stylelint 2
  run lint_file_call "$cwd/a.scss" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("trailing-semicolon")'
  run rg_or_grep -F "stylelint " "$RECORD"
  assert_success
}

@test "stylelint clean (exit 0) -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '.a{color:red;}\n' > "$cwd/a.scss"
  OUT=""
  rec_stub stylelint 0
  run lint_file_call "$cwd/a.scss" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "stylelint exit 1 (fatal error) -> {} (proves 0/2/else, not 0/1/else)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '.a{color:red;}\n' > "$cwd/a.scss"
  OUT='SyntaxError: Unexpected token'
  rec_stub stylelint 1
  run lint_file_call "$cwd/a.scss" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "stylelint absent but npx present -> npx --yes stylelint fallback runs, issues surfaced" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '.a{color:red}\n' > "$cwd/a.scss"
  OUT='a.scss:1:1: Expected a trailing semicolon (declaration-block-trailing-semicolon)'
  rec_stub npx 2
  run lint_file_call "$cwd/a.scss" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("trailing-semicolon")'
  run rg_or_grep -F "npx --yes stylelint $cwd/a.scss" "$RECORD"
  assert_success
}

@test "stylelint present on PATH -> npx never invoked even if present" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '.a{color:red;}\n' > "$cwd/a.scss"
  OUT="clean"
  rec_stub stylelint 0
  rec_stub npx 0
  run lint_file_call "$cwd/a.scss" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  run rg_or_grep -E "^stylelint " "$RECORD"
  assert_success
  run rg_or_grep -F "npx" "$RECORD"
  assert_failure
}

@test "stylelint finds an issue on a .css file (exit 2): additionalContext returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '.a{color:red}\n' > "$cwd/a.css"
  OUT='a.css:1:1: Expected a trailing semicolon (declaration-block-trailing-semicolon)'
  rec_stub stylelint 2
  run lint_file_call "$cwd/a.css" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("trailing-semicolon")'
  run rg_or_grep -F "stylelint " "$RECORD"
  assert_success
}

# --- behavioral: tsc (TypeScript type-check, independent of eslint) --------

