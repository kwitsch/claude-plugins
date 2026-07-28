#!/usr/bin/env bats

# eslint npx fallback (present/absent).

load 'test_helper'

setup() {
  common_setup
}

@test "eslint absent but npx present -> npx --yes eslint fallback runs, issues surfaced" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT='a.js: 1:1  error  x is assigned a value but never used  no-unused-vars'
  rec_stub npx 1
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("no-unused-vars")'
  run rg_or_grep -F "npx --yes eslint $cwd/a.js" "$RECORD"
  assert_success
}

@test "eslint present on PATH -> npx never invoked even if present" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT="clean"
  rec_stub eslint 0
  rec_stub npx 0   # present but must not be used
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  run rg_or_grep -E "^eslint " "$RECORD"
  assert_success
  run rg_or_grep -F "npx" "$RECORD"
  assert_failure
}

# --- behavioral: rtk detection ------------------------------------------------

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

