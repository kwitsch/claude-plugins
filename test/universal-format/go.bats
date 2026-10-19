#!/usr/bin/env bats

# Go fallback chain (goimports -> gofmt), both fed on stdin.

load 'test_helper'

setup() {
  common_setup
}

@test "go fallback chain: gofmt used when only gofmt present; goimports wins when both present and names the file via -srcdir" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  RECORD="$BATS_TEST_TMPDIR/rec1"; : > "$RECORD"
  rec_stub gofmt
  run pre_tool_use_write_call "$cwd/a.go" 'package main' "$cwd"
  assert_success
  run cat "$RECORD"
  assert_output "gofmt "          # no flags at all: gofmt reads stdin when given no file
  # now both present -> goimports (first in chain) wins
  RECORD="$BATS_TEST_TMPDIR/rec2"; : > "$RECORD"
  rec_stub goimports
  run pre_tool_use_write_call "$cwd/a.go" 'package main' "$cwd"
  assert_success
  run cat "$RECORD"
  assert_output "goimports -srcdir $cwd/a.go"
  run rg_or_grep -F "gofmt " "$RECORD"
  assert_failure
}
