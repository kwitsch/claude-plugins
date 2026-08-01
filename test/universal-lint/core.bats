#!/usr/bin/env bats

# Guard clauses and basic per-linter smoke tests (shellcheck/eslint/ruff/ktlint).

load 'test_helper'

setup() {
  common_setup
}

@test "shellcheck finds an issue: additionalContext returned with the stub's text" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  OUT='a.sh:1:6: note: Double quote to prevent globbing. [SC2086]'
  rec_stub shellcheck 1
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | test("SC2086"))'
  run rg_or_grep -F "shellcheck " "$RECORD"
  assert_success
  run cat "$cwd/a.sh"
  assert_output "echo \$1"   # linter never modifies the file
}

@test "shellcheck clean (exit 0) -> {} even though it printed text" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo "$1"\n' > "$cwd/a.sh"
  OUT='no problems'
  rec_stub shellcheck 0
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "no linter on PATH -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  run lint_file_call "$cwd/a.sh" "$cwd"       # no shellcheck stub created
  assert_success
  [ "$output" = "{}" ]
}

@test "non-target extension (.txt) -> linter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'hi\n' > "$cwd/a.txt"
  OUT="issue"
  rec_stub shellcheck 1
  run lint_file_call "$cwd/a.txt" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "path outside cwd -> linter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  local out="$BATS_TEST_TMPDIR/outside"; mkdir -p "$out"
  printf 'echo $1\n' > "$out/a.sh"
  OUT="issue"
  rec_stub shellcheck 1
  run lint_file_call "$out/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "node_modules path -> linter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/node_modules/x"
  printf 'echo $1\n' > "$cwd/node_modules/x/a.sh"
  OUT="issue"
  rec_stub shellcheck 1
  run lint_file_call "$cwd/node_modules/x/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test ".claude/worktrees path -> linter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/.claude/worktrees/foo"
  printf 'echo $1\n' > "$cwd/.claude/worktrees/foo/a.sh"
  OUT="issue"
  rec_stub shellcheck 1
  run lint_file_call "$cwd/.claude/worktrees/foo/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test ".claude/agent-memory path -> linter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/.claude/agent-memory"
  printf 'a: 1\n' > "$cwd/.claude/agent-memory/a.yaml"
  OUT="issue"
  rec_stub yamllint 1
  run lint_file_call "$cwd/.claude/agent-memory/a.yaml" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "*.local.* file -> linter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/settings.local.sh"
  OUT="issue"
  rec_stub shellcheck 1
  run lint_file_call "$cwd/settings.local.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test ".claude/rules path (not worktrees/agent-memory) -> linter still invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/.claude/rules"
  printf 'echo $1\n' > "$cwd/.claude/rules/a.sh"
  OUT="issue"
  rec_stub shellcheck 1
  run lint_file_call "$cwd/.claude/rules/a.sh" "$cwd"
  assert_success
  run rg_or_grep -F "shellcheck " "$RECORD"
  assert_success
}

@test "eslint exit 2 (config/internal error) -> {} even though it printed text (skip, not issues)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT='Oops! Something went wrong! :('
  rec_stub eslint 2
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "eslint exit 1 -> issues surfaced" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT='a.js: 1:1  error  x is assigned a value but never used  no-unused-vars'
  rec_stub eslint 1
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("no-unused-vars")'
}

@test "ruff check: subcommand precedes the file in recorded argv" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'x=1\n' > "$cwd/a.py"
  OUT="a.py:1:1: E225 missing whitespace around operator"
  rec_stub ruff 1
  run lint_file_call "$cwd/a.py" "$cwd"
  assert_success
  run rg_or_grep -F "ruff check" "$RECORD"
  assert_success
}

@test "ktlint clean (exit 0) -> {}; issues (exit 1) -> surfaced" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'fun main(){}\n' > "$cwd/a.kt"
  RECORD="$BATS_TEST_TMPDIR/rec1"; : > "$RECORD"
  OUT=""
  rec_stub ktlint 0
  run lint_file_call "$cwd/a.kt" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  RECORD="$BATS_TEST_TMPDIR/rec2"; : > "$RECORD"
  OUT="a.kt:1:1: Missing newline before \")\" (standard:parameter-list-wrapping)"
  rec_stub ktlint 1
  run lint_file_call "$cwd/a.kt" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("parameter-list-wrapping")'
}

# --- behavioral: Go directory-scoping + fallback chain -----------------------

@test "json extension -> linter never invoked (deliberately uncovered)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"a":1}' > "$cwd/a.json"
  OUT="issue"
  rec_stub eslint 1
  run lint_file_call "$cwd/a.json" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

