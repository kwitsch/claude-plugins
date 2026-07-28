#!/usr/bin/env bats

# MAX_CONTEXT_CHARS output capping.

load 'test_helper'

setup() {
  common_setup
}

@test "output over MAX_CONTEXT_CHARS is capped and marked truncated" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  OUT="$(printf 'x%.0s' $(seq 1 5000))"
  rec_stub shellcheck 1
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("… \\(truncated\\)$")'
}
