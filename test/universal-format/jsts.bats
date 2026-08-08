#!/usr/bin/env bats

# JS/TS belongs entirely to format_pre and the bundled prettier: no prettier binary, no npx, no
# stub of either is ever involved.

load 'test_helper'

setup() {
  common_setup
}

@test "jsts: format_pre formats a .ts file with no prettier and no npx anywhere on PATH" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.ts" 'let x=1' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "let x = 1;\n"'
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse"'
  echo "$output" | jq -e '.hookSpecificOutput | has("permissionDecision") | not'
}

@test "jsts: format_post returns {} for a prettier language, with prettier and npx stubs present but never run" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  rec_stub prettier
  rec_stub npx
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
  run cat "$cwd/a.js"
  assert_output "let x=1"
}
