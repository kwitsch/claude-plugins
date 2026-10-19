#!/usr/bin/env bats

# ruff/black on stdin: pyproject.toml/.editorconfig precedence, --stdin-filename, exit codes.

load 'test_helper'

setup() {
  common_setup
}

@test "python: pyproject [tool.ruff] beats .editorconfig -> ruff runs bare on stdin (no --line-length)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '[tool.ruff]\nline-length = 79\n' > "$cwd/pyproject.toml"
  printf 'root = true\n[*]\nmax_line_length = 88\n' > "$cwd/.editorconfig"
  rec_stub ruff
  run pre_tool_use_write_call "$cwd/a.py" 'x=1' "$cwd"
  assert_success
  run cat "$RECORD"
  assert_output "ruff format --quiet --stdin-filename $cwd/a.py -"
}

@test "python: .editorconfig only (no pyproject) -> ruff gets --line-length, then the stdin tail" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'root = true\n[*]\nmax_line_length = 88\n' > "$cwd/.editorconfig"
  rec_stub ruff
  run pre_tool_use_write_call "$cwd/a.py" 'x=1' "$cwd"
  assert_success
  run cat "$RECORD"
  assert_output "ruff format --quiet --line-length 88 --stdin-filename $cwd/a.py -"
}

@test "python: black (ruff absent) exits 123 echoing the input -> {} (only exit 0 is trusted)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  make_stub black 'printf "%s %s\n" black "$*" >> "$RECORD"' 'cat' 'exit 123'
  run pre_tool_use_write_call "$cwd/a.py" 'def f(:' "$cwd"
  assert_success
  [ "$output" = "{}" ]
  run cat "$RECORD"
  assert_output "black --quiet --stdin-filename $cwd/a.py -"
}
