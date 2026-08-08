#!/usr/bin/env bats

# .graphql/.gql through format_pre and the bundled prettier.

load 'test_helper'

setup() {
  common_setup
}

@test "graphql: format_pre formats a .graphql file with the bundled prettier" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.graphql" 'query   Q {  a }' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "query Q {\n  a\n}\n"'
}

@test "graphql: format_pre formats a .gql file too (.gql alias)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.gql" 'query   Q {  a }' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "query Q {\n  a\n}\n"'
}
