#!/usr/bin/env bats

# .yaml/.yml through format_pre and the bundled prettier; printWidth policy asserted on content.

load 'test_helper'

setup() {
  common_setup
}

# ~115 columns of flow sequence: wrapped at prettier's default 80, one line at printWidth 99999.
# The extra spaces after `a:` guarantee the formatted result differs from the input even in the
# unbounded case (an unchanged result would be a legitimate {} from format_pre).
long_yaml() {
  printf 'a:   [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]\n'
}

@test "yaml: format_pre formats a .yaml file with the bundled prettier" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.yaml" 'a:   1
' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "a: 1\n"'
}

@test "yaml: format_pre formats a .yml file too (.yml extension)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.yml" 'a:   1
' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "a: 1\n"'
}

@test "yaml: no project prettier config -> the long flow sequence is NOT wrapped" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.yaml" "$(long_yaml)" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content | split("\n") | length == 2'
}

@test "yaml: project .prettierrc present -> prettier's own default wraps the long flow sequence" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{}\n' > "$cwd/.prettierrc"
  run pre_tool_use_write_call "$cwd/a.yaml" "$(long_yaml)" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content | split("\n") | length > 2'
}

@test "yaml: .editorconfig max_line_length -> prettier honors it natively and wraps" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'root = true\n[*]\nmax_line_length = 40\n' > "$cwd/.editorconfig"
  run pre_tool_use_write_call "$cwd/a.yaml" "$(long_yaml)" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content | split("\n") | length > 2'
}
