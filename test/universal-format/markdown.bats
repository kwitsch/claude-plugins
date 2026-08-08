#!/usr/bin/env bats

# .md through format_pre and the bundled prettier.

load 'test_helper'

setup() {
  common_setup
}

@test "markdown: format_pre formats a markdown file with the bundled prettier" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.md" '#  hi
' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "# hi\n"'
}
