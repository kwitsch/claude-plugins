#!/usr/bin/env bats

# .json through format_pre and the bundled prettier. The printWidth policy is asserted on the
# produced CONTENT, not on a recorded subprocess argv — there is no subprocess any more.

load 'test_helper'

setup() {
  common_setup
}

# A 40-element array serialises well past 80 columns, so prettier's own default wraps it while the
# unbounded-printWidth policy keeps it on one line. Written without spaces so the formatted result
# always differs from the input (an unchanged result is a legitimate {} from format_pre).
long_json() {
  printf '[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39]'
}

@test "json: format_pre formats a json file with the bundled prettier (no stub on PATH)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.json" '{"a":1}' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "{ \"a\": 1 }\n"'
}

@test "json: no project prettier config -> the long array is NOT wrapped (printWidth unbounded)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.json" "$(long_json)" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content | split("\n") | length == 2'
}

@test "json: top-level \"prettier\" key in package.json -> prettier's own default wraps the long array" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '%s' '{"prettier": {}}' > "$cwd/package.json"
  run pre_tool_use_write_call "$cwd/a.json" "$(long_json)" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content | split("\n") | length > 2'
}
