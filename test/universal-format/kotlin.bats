#!/usr/bin/env bats

# Kotlin (ktlint) exit-code-independence case.

load 'test_helper'

setup() {
  common_setup
}

@test "formatter exits 1 AFTER changing file (ktlint case) -> additionalContext still returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'fun main(){}\n' > "$cwd/a.kt"
  make_stub ktlint \
    'printf "%s %s\n" ktlint "$*" >> "$RECORD"' \
    'for last; do :; done' \
    'printf "reformatted\n" > "$last"' \
    'exit 1'
  run format_file_call "$cwd/a.kt" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("ktlint reformatted a.kt")'
}

# --- behavioral: .editorconfig mapping + tool-native-config precedence -------

