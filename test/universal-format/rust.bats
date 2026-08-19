#!/usr/bin/env bats

# Rust (rustfmt) single-tool chain: mapped strategy, rustfmt formats a bare file path in place.

load 'test_helper'

setup() {
  common_setup
}

@test "rust: rustfmt on PATH, no config -> runs bare (in place)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'fn main(){}\n' > "$cwd/a.rs"
  rec_stub rustfmt
  run format_file_call "$cwd/a.rs" "$cwd"
  assert_success
  run rg_or_grep -F "rustfmt " "$RECORD"
  assert_success
}

@test "rust: rustfmt.toml present -> native-config bypass (no --config emitted)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'fn main(){}\n' > "$cwd/a.rs"
  printf 'max_width = 100\n' > "$cwd/rustfmt.toml"
  printf 'root = true\n[*]\nmax_line_length = 120\n' > "$cwd/.editorconfig"
  rec_stub rustfmt
  run format_file_call "$cwd/a.rs" "$cwd"
  assert_success
  run rg_or_grep -F -- "--config" "$RECORD"
  assert_failure
}

@test "rust: rustfmt absent -> silent no-op, nothing recorded" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'fn main(){}\n' > "$cwd/a.rs"
  run format_file_call "$cwd/a.rs" "$cwd"
  assert_success
  run rg_or_grep -F "rustfmt " "$RECORD"
  assert_failure
}

@test "rust: rustfmt exits 1 AFTER rewriting file -> additionalContext still returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'fn main(){}\n' > "$cwd/a.rs"
  make_stub rustfmt \
    'printf "%s %s\n" rustfmt "$*" >> "$RECORD"' \
    'for last; do :; done' \
    'printf "reformatted\n" > "$last"' \
    'exit 1'
  run format_file_call "$cwd/a.rs" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("rustfmt reformatted a.rs")'
}
