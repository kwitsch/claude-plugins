#!/usr/bin/env bats

# Go directory-scoping and golangci-lint/go-vet fallback.

load 'test_helper'

setup() {
  common_setup
}

@test "go fallback: only go(vet) stub present -> used, targets the directory" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/pkg"
  printf 'package pkg\n' > "$cwd/pkg/a.go"
  OUT="pkg/a.go:1: some vet finding"
  rec_stub go 1
  run lint_file_call "$cwd/pkg/a.go" "$cwd"
  assert_success
  run rg_or_grep -F "go vet $cwd/pkg" "$RECORD"   # directory, not the file
  assert_success
}

@test "go fallback: golangci-lint present -> wins over go vet, targets the directory" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/pkg"
  printf 'package pkg\n' > "$cwd/pkg/a.go"
  OUT="pkg/a.go:1: some finding"
  rec_stub golangci-lint 1
  rec_stub go 1   # never runs (golangci-lint wins) -- shares $OUT harmlessly
  run lint_file_call "$cwd/pkg/a.go" "$cwd"
  assert_success
  run rg_or_grep -F "golangci-lint run $cwd/pkg" "$RECORD"
  assert_success
  run rg_or_grep -F "go vet" "$RECORD"
  assert_failure
}
