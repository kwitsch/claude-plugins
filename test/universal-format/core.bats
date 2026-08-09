#!/usr/bin/env bats

# Guard clauses and the exit-code-independence contract.

load 'test_helper'

setup() {
  common_setup
}

@test "formats a go file: gofmt runs, file changes, additionalContext returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'package main\n' > "$cwd/a.go"
  rec_stub gofmt
  run format_file_call "$cwd/a.go" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput as $h | $h.hookEventName == "PostToolUse" and ($h.additionalContext | test("gofmt reformatted a.go")) and ($h.additionalContext | test("exempt from .surgical/minimal-diff. change-scope rules"))'
  run rg_or_grep -F "gofmt " "$RECORD"
  assert_success
  run cat "$cwd/a.go"
  assert_output --partial "reformatted-by-gofmt"
}

@test "no formatter on PATH -> file untouched, {} result" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'package main\n' > "$cwd/a.go"
  run format_file_call "$cwd/a.go" "$cwd"       # no gofmt/goimports stub created
  assert_success
  [ "$output" = "{}" ]
  run cat "$cwd/a.go"
  assert_output "package main"
}

@test "non-target extension (.txt) -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'hi\n' > "$cwd/a.txt"
  rec_stub gofmt
  run format_file_call "$cwd/a.txt" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "path outside cwd -> formatted against its own project" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  local out="$BATS_TEST_TMPDIR/outside"; mkdir -p "$out"
  printf 'package main\n' > "$out/a.go"
  rec_stub gofmt
  run format_file_call "$out/a.go" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "PostToolUse"'
  run rg_or_grep -F "gofmt " "$RECORD"
  assert_success
  run cat "$out/a.go"
  assert_output --partial "reformatted-by-gofmt"
}

@test "node_modules path -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/node_modules/x"
  printf 'package main\n' > "$cwd/node_modules/x/a.go"
  rec_stub gofmt
  run format_file_call "$cwd/node_modules/x/a.go" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test ".claude/worktrees path -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/.claude/worktrees/foo"
  printf 'package main\n' > "$cwd/.claude/worktrees/foo/a.go"
  rec_stub gofmt
  run format_file_call "$cwd/.claude/worktrees/foo/a.go" "$cwd"
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
  printf 'package main\n' > "$cwd/settings.local.go"
  rec_stub gofmt
  run format_file_call "$cwd/settings.local.go" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test ".claude/rules path (not worktrees/agent-memory) -> formatter still invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/.claude/rules"
  printf 'package main\n' > "$cwd/.claude/rules/a.go"
  rec_stub gofmt
  run format_file_call "$cwd/.claude/rules/a.go" "$cwd"
  assert_success
  run rg_or_grep -F "gofmt " "$RECORD"
  assert_success
}

@test "formatter exits 1 WITHOUT changing file -> {} (no crash)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'package main\n' > "$cwd/a.go"
  make_stub gofmt 'printf "%s %s\n" gofmt "$*" >> "$RECORD"' 'exit 1'   # no file change
  run format_file_call "$cwd/a.go" "$cwd"
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

@test "PreToolUse: path outside cwd -> formatted against its own project" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  local out="$BATS_TEST_TMPDIR/outside"; mkdir -p "$out"
  run pre_tool_use_write_call "$out/a.json" '{"a":1}' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "{ \"a\": 1 }\n"'
}

@test "absent cwd + absolute path -> still formatted" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local out="$BATS_TEST_TMPDIR/nocwd"; mkdir -p "$out"
  run pre_tool_use_write_call "$out/a.json" '{"a":1}' ""
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "{ \"a\": 1 }\n"'
}

@test "PreToolUse: non-prettier extension (.go) -> {} (go is PostToolUse only)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.go" 'package main' "$cwd"
  assert_success
  [ "$output" = "{}" ]
}
