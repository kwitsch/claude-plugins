#!/usr/bin/env bats

# markdownlint/markdownlint-cli2 chain + npx fallback.

load 'test_helper'

setup() {
  common_setup
}

@test "markdown fallback: only markdownlint present -> used" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '# hi\n' > "$cwd/a.md"
  OUT='a.md:1 MD041/first-line-heading'
  rec_stub markdownlint 1
  run lint_file_call "$cwd/a.md" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("MD041")'
  run rg_or_grep -F "markdownlint " "$RECORD"
  assert_success
}

@test "markdown fallback: markdownlint-cli2 present -> wins over markdownlint (chain order)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '# hi\n' > "$cwd/a.md"
  OUT='a.md:1 MD041/first-line-heading'
  rec_stub markdownlint-cli2 1
  rec_stub markdownlint 1   # never runs -- cli2 wins
  run lint_file_call "$cwd/a.md" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("MD041")'
  run rg_or_grep -F "markdownlint-cli2 " "$RECORD"
  assert_success
  run rg_or_grep -E "^markdownlint " "$RECORD"
  assert_failure
}

@test "markdown: markdownlint on PATH, markdownlint-cli2 absent, npx present -> markdownlint wins (PATH beats npx-only)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '# hi\n' > "$cwd/a.md"
  OUT='a.md:1 MD041/first-line-heading'
  rec_stub markdownlint 1
  rec_stub npx 1   # present but must not be used -- markdownlint is genuinely installed
  run lint_file_call "$cwd/a.md" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("MD041")'
  run rg_or_grep -E "^markdownlint " "$RECORD"
  assert_success
  run rg_or_grep -F "npx" "$RECORD"
  assert_failure
}

@test "markdownlint-cli2 absent but npx present -> npx --yes markdownlint-cli2 fallback runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '# hi\n' > "$cwd/a.md"
  OUT='a.md:1 MD041/first-line-heading'
  rec_stub npx 1
  run lint_file_call "$cwd/a.md" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("MD041")'
  run rg_or_grep -F "npx --yes markdownlint-cli2 $cwd/a.md" "$RECORD"
  assert_success
}

# --- behavioral: stylelint (CSS/SCSS) ------------------------------------------

