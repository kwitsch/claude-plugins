#!/usr/bin/env bats

# ruff pyproject.toml/.editorconfig precedence.

load 'test_helper'

setup() {
  common_setup
}

@test "python: pyproject [tool.ruff] beats .editorconfig -> ruff runs bare (no --line-length)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'x=1\n' > "$cwd/a.py"
  printf '[tool.ruff]\nline-length = 79\n' > "$cwd/pyproject.toml"
  printf 'root = true\n[*]\nmax_line_length = 88\n' > "$cwd/.editorconfig"
  rec_stub ruff
  run format_file_call "$cwd/a.py" "$cwd"
  assert_success
  run rg_or_grep -F -- "--line-length" "$RECORD"
  assert_failure
}

@test "python: .editorconfig only (no pyproject) -> ruff gets --line-length" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'x=1\n' > "$cwd/a.py"
  printf 'root = true\n[*]\nmax_line_length = 88\n' > "$cwd/.editorconfig"
  rec_stub ruff
  run format_file_call "$cwd/a.py" "$cwd"
  assert_success
  run rg_or_grep -F -- "--line-length 88" "$RECORD"
  assert_success
}

