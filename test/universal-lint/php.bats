#!/usr/bin/env bats

# PHP (phpstan/psalm) fallback and classification cases.

load 'test_helper'

setup() {
  common_setup
}

@test "phpstan on PATH, reports issues (exit 1) -> additionalContext returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '<?php echo $undefinedVar;\n' > "$cwd/a.php"
  OUT='a.php:1: Undefined variable: $undefinedVar'
  rec_stub phpstan 1
  run lint_file_call "$cwd/a.php" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("Undefined variable")'
  run rg_or_grep -F "phpstan analyse $cwd/a.php" "$RECORD"
  assert_success
}

@test "phpstan absent, psalm on PATH, reports issues (exit 2) -> additionalContext returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '<?php echo $undefinedVar;\n' > "$cwd/a.php"
  OUT="ERROR: PossiblyUndefinedVariable"
  rec_stub psalm 2
  run lint_file_call "$cwd/a.php" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("PossiblyUndefinedVariable")'
  run rg_or_grep -F "psalm $cwd/a.php" "$RECORD"
  assert_success
}

@test "psalm exits 1 (problem running, e.g. missing config) -> treated as skip, no output" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '<?php echo $undefinedVar;\n' > "$cwd/a.php"
  OUT="Could not locate a config XML file"
  rec_stub psalm 1
  run lint_file_call "$cwd/a.php" "$cwd"
  assert_success
  assert_output "{}"
}
