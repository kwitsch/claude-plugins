#!/usr/bin/env bats

# rtk detection and fallback behavior.

load 'test_helper'

setup() {
  common_setup
}

# rtk_stub <verb> <exit_code> -- stub $MOCKBIN/rtk that answers BOTH shapes:
#   rtk rewrite <tool> <args...> __RTK_PROBE__   -> echoes "rtk <verb> __RTK_PROBE__"
#   rtk <verb> <args...>                         -> records argv, prints $OUT, exits <exit_code>
rtk_stub() {
  local verb="$1" exit_code="$2"
  make_stub rtk \
    'if [ "$1" = "rewrite" ]; then printf "rtk %s __RTK_PROBE__\n" "'"$verb"'"; exit 3; fi' \
    'printf "%s %s\n" "rtk" "$*" >> "$RECORD"' \
    'printf '\''%s\n'\'' "$OUT"' \
    'exit '"$exit_code"
}

@test "rtk: shellcheck on PATH + rtk supports it -> lint runs via rtk, issues surfaced" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  OUT='a.sh:1:6: note: Double quote to prevent globbing. [SC2086]'
  rec_stub shellcheck 1
  rtk_stub shellcheck 1
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("SC2086")'
  run rg_or_grep -F "rtk shellcheck $cwd/a.sh" "$RECORD"
  assert_success
  run rg_or_grep -E "^shellcheck " "$RECORD"
  assert_failure
}

@test "rtk: checkstyle unsupported by rtk -> falls through to direct invocation" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  OUT=$'Starting audit...\nAudit done.'
  rec_stub checkstyle 0
  make_stub rtk \
    'if [ "$1" = "rewrite" ]; then exit 1; fi' \
    'echo "rtk should not run the actual tool" >&2' \
    'exit 1'
  run lint_file_call "$cwd/A.java" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  run rg_or_grep -E "^checkstyle " "$RECORD"
  assert_success
}

@test "rtk: rtk supports the tool but the run itself is killed -> falls back to direct invocation" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  OUT='a.sh:1:6: note: Double quote to prevent globbing. [SC2086]'
  rec_stub shellcheck 1
  make_stub rtk \
    'if [ "$1" = "rewrite" ]; then printf "rtk shellcheck __RTK_PROBE__\n"; exit 3; fi' \
    'kill -KILL $$'
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("SC2086")'
  run rg_or_grep -E "^shellcheck " "$RECORD"
  assert_success
}

@test "rtk: a clean non-zero exit with empty stdout (rtk-internal failure) falls back to direct invocation, not misreported as a finding" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  OUT='a.sh:1:6: note: Double quote to prevent globbing. [SC2086]'
  rec_stub shellcheck 1
  make_stub rtk \
    'if [ "$1" = "rewrite" ]; then printf "rtk shellcheck __RTK_PROBE__\n"; exit 3; fi' \
    'echo "rtk: internal error, could not reach backend" >&2' \
    'exit 2'
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("SC2086")'
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("internal error") | not'
  run rg_or_grep -E "^shellcheck " "$RECORD"
  assert_success
}

@test "rtk: npx-fallback tool routes through rtk's own discovered verb, not a raw npx wrap" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT='ESLint: 1 errors, 0 warnings in 1 files'
  rtk_stub lint 1
  # npx must be present on PATH (isToolAvailable/selectLintTool require it for
  # eslint's npmSpec candidacy) but must never actually run once rtk succeeds.
  make_stub npx \
    'printf "%s %s\n" "npx" "$*" >> "$RECORD"' \
    'echo "npx should not run when rtk succeeds" >&2' \
    'exit 1'
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("ESLint")'
  run rg_or_grep -F "rtk lint $cwd/a.js" "$RECORD"
  assert_success
  run rg_or_grep -F "npx" "$RECORD"
  assert_failure
}

@test "rtk: npx-fallback falls back to bare npx when the rtk call errors" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT='a.js: 1:1  error  x is assigned a value but never used  no-unused-vars'
  make_stub rtk 'kill -KILL $$'
  rec_stub npx 1
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("no-unused-vars")'
  run rg_or_grep -F "npx --yes eslint $cwd/a.js" "$RECORD"
  assert_success
}

@test "rtk: npx-fallback tool's discovered verb invocation fails (real binary missing) -> falls back to bare npx" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT='a.js: 1:1  error  x is assigned a value but never used  no-unused-vars'
  make_stub rtk \
    'if [ "$1" = "rewrite" ]; then printf "rtk lint __RTK_PROBE__\n"; exit 3; fi' \
    'echo "[rtk: No such file or directory (os error 2)]" >&2' \
    'exit 127'
  rec_stub npx 1
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("no-unused-vars")'
  run rg_or_grep -F "npx --yes eslint $cwd/a.js" "$RECORD"
  assert_success
}

