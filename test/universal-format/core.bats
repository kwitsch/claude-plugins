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
  echo "$output" | jq -e '.hookSpecificOutput as $h | $h.hookEventName == "PostToolUse" and ($h.additionalContext | test("shfmt reformatted a.sh")) and ($h.additionalContext | test("exempt from .surgical/minimal-diff. change-scope rules"))'
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

@test ".claude/worktrees path -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/.claude/worktrees/foo"
  printf 'echo x\n' > "$cwd/.claude/worktrees/foo/a.sh"
  rec_stub shfmt
  run format_file_call "$cwd/.claude/worktrees/foo/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test ".claude/agent-memory path -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/.claude/agent-memory"
  printf 'hi\n' > "$cwd/.claude/agent-memory/a.md"
  rec_stub prettier
  run format_file_call "$cwd/.claude/agent-memory/a.md" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "*.local.* file -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo  hi\n' > "$cwd/settings.local.sh"
  rec_stub shfmt
  run format_file_call "$cwd/settings.local.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test ".claude/rules path (not worktrees/agent-memory) -> formatter still invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/.claude/rules"
  printf 'echo  hi\n' > "$cwd/.claude/rules/a.sh"
  rec_stub shfmt
  run format_file_call "$cwd/.claude/rules/a.sh" "$cwd"
  assert_success
  run rg_or_grep -F "shfmt " "$RECORD"
  assert_success
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

@test "PreToolUse: excluded path (node_modules) -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/node_modules/x"
  run pre_tool_use_write_call "$cwd/node_modules/x/a.json" '{"a":1}' "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "PreToolUse: path outside cwd -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  local out="$BATS_TEST_TMPDIR/outside"; mkdir -p "$out"
  run pre_tool_use_write_call "$out/a.json" '{"a":1}' "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "PreToolUse: non-prettier extension (.sh) -> {} (shell is PostToolUse only)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.sh" 'echo hi' "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

