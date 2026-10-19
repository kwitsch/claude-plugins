#!/usr/bin/env bats

# Rust (rustfmt) single-tool chain: mapped strategy, fed on stdin from the file's own directory
# (rustfmt finds rustfmt.toml by walking up from cwd; it has no path flag for stdin input).

load 'test_helper'

setup() {
  common_setup
}

@test "rust: rustfmt on PATH, no config -> runs bare on stdin, cwd is the file's directory" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/src"
  make_stub rustfmt 'printf "%s %s %s\n" rustfmt "$*" "$PWD" >> "$RECORD"' 'cat >/dev/null' 'printf "reformatted\n"'
  run pre_tool_use_write_call "$cwd/src/a.rs" 'fn main(){}' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "reformatted\n"'
  run cat "$RECORD"
  assert_output "rustfmt  $cwd/src"
}

@test "rust: rustfmt.toml present -> native-config bypass (no --config emitted)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'max_width = 100\n' > "$cwd/rustfmt.toml"
  printf 'root = true\n[*]\nmax_line_length = 120\n' > "$cwd/.editorconfig"
  rec_stub rustfmt
  run pre_tool_use_write_call "$cwd/a.rs" 'fn main(){}' "$cwd"
  assert_success
  run rg_or_grep -F -- "--config" "$RECORD"
  assert_failure
}

@test "rust: rustfmt absent -> silent no-op, nothing recorded" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.rs" 'fn main(){}' "$cwd"
  assert_success
  [ "$output" = "{}" ]
  run rg_or_grep -F "rustfmt " "$RECORD"
  assert_failure
}

@test "rust: rustfmt exits 1 (its failure code) -> {} even when it printed output" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  make_stub rustfmt 'cat >/dev/null' 'printf "garbage\n"' 'exit 1'
  run pre_tool_use_write_call "$cwd/a.rs" 'fn main(){}' "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "rust: .editorconfig max_line_length -> rustfmt gets --config max_width" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'root = true\n[*]\nmax_line_length = 120\n' > "$cwd/.editorconfig"
  rec_stub rustfmt
  run pre_tool_use_write_call "$cwd/a.rs" 'fn main(){}' "$cwd"
  assert_success
  run rg_or_grep -F -- "--config max_width=120" "$RECORD"
  assert_success
}
