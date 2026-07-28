#!/usr/bin/env bats

# Guard clauses and the exit-code-independence contract.

load 'test_helper'

setup() {
  common_setup
}

@test "formats a shell file: shfmt runs, file changes, additionalContext returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo  hi\n' > "$cwd/a.sh"
  rec_stub shfmt
  run format_file_call "$cwd/a.sh" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | test("shfmt reformatted a.sh"))'
  run rg_or_grep -F "shfmt " "$RECORD"
  assert_success
  run cat "$cwd/a.sh"
  assert_output --partial "reformatted-by-shfmt"
}

@test "no formatter on PATH -> file untouched, {} result" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo  hi\n' > "$cwd/a.sh"
  run format_file_call "$cwd/a.sh" "$cwd"       # no shfmt stub created
  assert_success
  [ "$output" = "{}" ]
  run cat "$cwd/a.sh"
  assert_output "echo  hi"
}

@test "non-target extension (.txt) -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'hi\n' > "$cwd/a.txt"
  rec_stub shfmt
  run format_file_call "$cwd/a.txt" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "path outside cwd -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  local out="$BATS_TEST_TMPDIR/outside"; mkdir -p "$out"
  printf 'echo x\n' > "$out/a.sh"
  rec_stub shfmt
  run format_file_call "$out/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "node_modules path -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/node_modules/x"
  printf 'echo x\n' > "$cwd/node_modules/x/a.sh"
  rec_stub shfmt
  run format_file_call "$cwd/node_modules/x/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "formatter exits 1 WITHOUT changing file -> {} (no crash)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo  hi\n' > "$cwd/a.sh"
  make_stub shfmt 'printf "%s %s\n" shfmt "$*" >> "$RECORD"' 'exit 1'   # no file change
  run format_file_call "$cwd/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

