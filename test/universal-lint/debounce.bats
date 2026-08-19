#!/usr/bin/env bats

# Per-file 5s-idle debounce (token-marker) behavior for universal-lint.
# Uses a small non-zero window via UNIVERSAL_LINT_DEBOUNCE_MS to keep tests fast.

load 'test_helper'

setup() {
  common_setup
}

@test "debounce: two rapid edits to one file run the linter once (older invocation superseded)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  OUT='a.sh:1:6: note: something [SC2086]'
  UNIVERSAL_LINT_DEBOUNCE_MS=400
  rec_stub shellcheck 1
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"

  lint_file_call "$cwd/a.sh" "$cwd" &   # first: writes token, sleeps 400ms, then bails (superseded)
  sleep 0.1
  lint_file_call "$cwd/a.sh" "$cwd"     # second: newer token, wins, runs the linter
  wait                                  # let the backgrounded first process finish

  [ "$(wc -l < "$RECORD" | tr -d ' ')" -eq 1 ]
}

@test "debounce: a single edit with a non-zero window still runs the linter exactly once" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  OUT='a.sh:1:6: note: something [SC2086]'
  UNIVERSAL_LINT_DEBOUNCE_MS=200
  rec_stub shellcheck 1
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"

  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  [ "$(wc -l < "$RECORD" | tr -d ' ')" -eq 1 ]
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("SC2086")'
}

@test "debounce: UNIVERSAL_LINT_DEBOUNCE_MS=0 runs the linter immediately (test fast-path)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  OUT='a.sh:1:6: note: something [SC2086]'
  UNIVERSAL_LINT_DEBOUNCE_MS=0
  rec_stub shellcheck 1
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"

  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  [ "$(wc -l < "$RECORD" | tr -d ' ')" -eq 1 ]
}
