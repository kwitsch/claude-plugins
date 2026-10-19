#!/usr/bin/env bats

# Guard clauses and the stdin-formatter contract of the CLI languages (gofmt is the vehicle).

load 'test_helper'

setup() {
  common_setup
}

@test "formats a go file: gofmt is fed the content on stdin, its stdout becomes updatedInput, additionalContext returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  rec_stub gofmt
  run pre_tool_use_write_call "$cwd/a.go" 'package main' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput as $h | $h.hookEventName == "PreToolUse" and $h.updatedInput.content == "reformatted-by-gofmt\n" and ($h.additionalContext | test("gofmt reformatted a.go")) and ($h.additionalContext | test("exempt from .surgical/minimal-diff. change-scope rules"))'
  echo "$output" | jq -e '.hookSpecificOutput | has("permissionDecision") | not'
  run rg_or_grep -F "gofmt " "$RECORD"
  assert_success
  [ ! -e "$cwd/a.go" ]   # nothing is written by the hook itself
}

@test "no formatter on PATH -> {} result" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.go" 'package main' "$cwd"       # no gofmt/goimports stub created
  assert_success
  [ "$output" = "{}" ]
}

@test "non-target extension (.txt) -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  rec_stub gofmt
  run pre_tool_use_write_call "$cwd/a.txt" 'hi' "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "path outside cwd -> formatted against its own project" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  local out="$BATS_TEST_TMPDIR/outside"; mkdir -p "$out"
  rec_stub gofmt
  run pre_tool_use_write_call "$out/a.go" 'package main' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "reformatted-by-gofmt\n"'
  echo "$output" | jq -e --arg p "$out/a.go" '.hookSpecificOutput.additionalContext | test("gofmt reformatted " + $p)'
  run rg_or_grep -F "gofmt " "$RECORD"
  assert_success
}

@test "node_modules path -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/node_modules/x"
  rec_stub gofmt
  run pre_tool_use_write_call "$cwd/node_modules/x/a.go" 'package main' "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test ".claude/worktrees path -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/.claude/worktrees/foo"
  rec_stub gofmt
  run pre_tool_use_write_call "$cwd/.claude/worktrees/foo/a.go" 'package main' "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test ".claude/agent-memory path -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/.claude/agent-memory"
  run pre_tool_use_write_call "$cwd/.claude/agent-memory/a.md" '#  hi' "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "*.local.* file -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  rec_stub gofmt
  run pre_tool_use_write_call "$cwd/settings.local.go" 'package main' "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test ".claude/rules path (not worktrees/agent-memory) -> formatter still invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/.claude/rules"
  rec_stub gofmt
  run pre_tool_use_write_call "$cwd/.claude/rules/a.go" 'package main' "$cwd"
  assert_success
  run rg_or_grep -F "gofmt " "$RECORD"
  assert_success
}

@test "formatter exits non-zero -> {} even though it printed something (only an ok exit code's stdout is trusted)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  make_stub gofmt 'cat >/dev/null' 'printf "partial\n"' 'exit 2'
  run pre_tool_use_write_call "$cwd/a.go" 'package main' "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "formatter exits 0 with EMPTY stdout -> {} (an empty result is never written)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  make_stub gofmt 'cat >/dev/null' 'exit 0'
  run pre_tool_use_write_call "$cwd/a.go" 'package main' "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "formatter output identical to the input -> {} (content diff decides, not the exit code)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  make_stub gofmt 'cat'
  run pre_tool_use_write_call "$cwd/a.go" 'package main' "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "Edit on a CLI-language file: the merged file goes through the formatter and only the changed run of lines is swapped" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'package main\n\nfunc a() {}\n\nfunc b() {}\n' > "$cwd/a.go"
  make_stub gofmt 'while IFS= read -r l; do printf "%s\n" "${l//x:=1/x := 1}"; done'   # a "formatter" that fixes exactly the edited line
  run pre_tool_use_edit_call "$cwd/a.go" 'func a() {}' 'func a() { x:=1 }' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput | .old_string == "func a() {}\n" and .new_string == "func a() { x := 1 }\n" and .replace_all == false'
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("gofmt reformatted a.go")'
  run cat "$cwd/a.go"
  assert_output --partial 'func a() {}'   # the hook never touches the file itself
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

@test ".prettierignore opts a prettier language out but never a CLI language (its opt-out is not installing the tool)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a.json\na.go\n' > "$cwd/.prettierignore"
  rec_stub gofmt
  run pre_tool_use_write_call "$cwd/a.json" '{"a":1}' "$cwd"
  assert_success
  [ "$output" = "{}" ]
  run pre_tool_use_write_call "$cwd/a.go" 'package main' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "reformatted-by-gofmt\n"'
}
