#!/usr/bin/env bats

# checkstyle output-classification and config resolution.

load 'test_helper'

setup() {
  common_setup
}

@test "checkstyle: boilerplate-only exit 0 -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  OUT=$'Starting audit...\nAudit done.'
  rec_stub checkstyle 0
  run lint_file_call "$cwd/A.java" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "checkstyle: boilerplate + warning-severity violation, exit 0 -> issues surfaced (proves NOT exit-code based)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  OUT=$'Starting audit...\n[WARN] A.java:1: Missing a Javadoc comment. [JavadocType]\nAudit done.'
  rec_stub checkstyle 0
  run lint_file_call "$cwd/A.java" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("JavadocType")'
}

@test "checkstyle: no 'Audit done.' (crash) -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  OUT='Exception in thread "main" java.lang.RuntimeException: bad config'
  rec_stub checkstyle 1
  run lint_file_call "$cwd/A.java" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "checkstyle: project checkstyle.xml present -> -c <path to it> in recorded argv" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  printf '<module name="Checker"/>\n' > "$cwd/checkstyle.xml"
  OUT=$'Starting audit...\nAudit done.'
  rec_stub checkstyle 0
  run lint_file_call "$cwd/A.java" "$cwd"
  assert_success
  run rg_or_grep -F -- "-c $cwd/checkstyle.xml" "$RECORD"
  assert_success
}

@test "checkstyle: no project config -> -c /google_checks.xml in recorded argv" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  OUT=$'Starting audit...\nAudit done.'
  rec_stub checkstyle 0
  run lint_file_call "$cwd/A.java" "$cwd"
  assert_success
  run rg_or_grep -F -- "-c /google_checks.xml" "$RECORD"
  assert_success
}
