#!/usr/bin/env bats

# prettier for .md.

load 'test_helper'

setup() {
  common_setup
}

@test "formats a markdown file: prettier runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '# hi\n' > "$cwd/a.md"
  rec_stub prettier
  run format_file_call "$cwd/a.md" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.md")'
}

# --- behavioral: CSS/SCSS (prettier native; biome mapped, CSS only) --------

