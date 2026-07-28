#!/usr/bin/env bats

# Go fallback chain (goimports -> gofmt).

load 'test_helper'

setup() {
  common_setup
}

@test "go fallback chain: gofmt used when only gofmt present; goimports wins when both present" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'package main\n' > "$cwd/a.go"
  RECORD="$BATS_TEST_TMPDIR/rec1"; : > "$RECORD"
  rec_stub gofmt
  run format_file_call "$cwd/a.go" "$cwd"
  assert_success
  run rg_or_grep -F "gofmt " "$RECORD"
  assert_success
  # now both present -> goimports (first in chain) wins
  RECORD="$BATS_TEST_TMPDIR/rec2"; : > "$RECORD"
  printf 'package main\n' > "$cwd/a.go"
  rec_stub goimports
  run format_file_call "$cwd/a.go" "$cwd"
  assert_success
  run rg_or_grep -F "goimports " "$RECORD"
  assert_success
  run rg_or_grep -F "gofmt " "$RECORD"
  assert_failure
}

