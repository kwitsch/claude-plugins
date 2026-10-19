#!/usr/bin/env bats

# Kotlin (ktlint -> ktfmt) on stdin: ktlint's exit-code semantics and the --stdin flags.

load 'test_helper'

setup() {
  common_setup
}

@test "ktlint exits 1 (violations it cannot fix remain) with the formatted file on stdout -> still applied" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  make_stub ktlint 'printf "%s %s\n" ktlint "$*" >> "$RECORD"' 'cat >/dev/null' 'printf "reformatted\n"' 'exit 1'
  run pre_tool_use_write_call "$cwd/a.kt" 'fun main(){}' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "reformatted\n"'
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("ktlint reformatted a.kt")'
  run cat "$RECORD"
  assert_output "ktlint --format --log-level=none --stdin --stdin-path $cwd/a.kt"
}

@test "ktlint exits 0 with EMPTY stdout (its syntax-error shape) -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  make_stub ktlint 'cat >/dev/null' 'exit 0'
  run pre_tool_use_write_call "$cwd/a.kt" 'fun main(' "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "ktfmt (fallback when ktlint is absent) gets --stdin-name=<file> and reads stdin via -" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  rec_stub ktfmt
  run pre_tool_use_write_call "$cwd/a.kts" 'fun main(){}' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "reformatted-by-ktfmt\n"'
  run cat "$RECORD"
  assert_output "ktfmt --enable-editorconfig --quiet --stdin-name=$cwd/a.kts -"
}
