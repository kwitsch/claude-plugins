#!/usr/bin/env bats

# yamllint finds-issue / clean.

load 'test_helper'

setup() {
  common_setup
}

@test "yamllint finds an issue: additionalContext returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a:   1\n' > "$cwd/a.yaml"
  OUT='a.yaml:1:4: [warning] too many spaces after colon (colons)'
  rec_stub yamllint 1
  run lint_file_call "$cwd/a.yaml" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("colons")'
  run rg_or_grep -F "yamllint " "$RECORD"
  assert_success
}

@test "yamllint clean (exit 0) -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a: 1\n' > "$cwd/a.yaml"
  OUT=""
  rec_stub yamllint 0
  run lint_file_call "$cwd/a.yaml" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "yaml: no project .yamllint config -> -d disables line-length (recorded argv)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a: 1\n' > "$cwd/a.yaml"
  OUT=""
  rec_stub yamllint 0
  run lint_file_call "$cwd/a.yaml" "$cwd"
  assert_success
  run rg_or_grep -F "rules: {line-length: disable}" "$RECORD"
  assert_success
}

@test "yaml: project .yamllint present -> no -d override, yamllint runs bare" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a: 1\n' > "$cwd/a.yaml"
  printf 'extends: default\n' > "$cwd/.yamllint"
  OUT=""
  rec_stub yamllint 0
  run lint_file_call "$cwd/a.yaml" "$cwd"
  assert_success
  run rg_or_grep -F "line-length: disable" "$RECORD"
  assert_failure
  run rg_or_grep -F "yamllint $cwd/a.yaml" "$RECORD"
  assert_success
}

