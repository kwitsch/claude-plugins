#!/usr/bin/env bats

# prettier chain, npx fallback.

load 'test_helper'

setup() {
  common_setup
}

@test "jsts: prettier absent but npx present -> npx --yes prettier fallback runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  rec_stub npx
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.js")'
  run rg_or_grep -F "npx --yes prettier" "$RECORD"
  assert_success
  run cat "$cwd/a.js"
  assert_output --partial "reformatted-by-npx"
}

@test "jsts: prettier present on PATH -> npx never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  rec_stub prettier
  rec_stub npx   # present but must not be used
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  run rg_or_grep -E "^prettier " "$RECORD"
  assert_success
  run rg_or_grep -F "npx" "$RECORD"
  assert_failure
}

@test "jsts: prettier absent, npx also absent -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

# Async-driver proof: `format_pre` on a project with an importable prettier answers only after a
# real async in-process format, so a driver that closes stdin immediately loses the response.
# The project-local prettier fixture is only needed until the bundled prettier lands.
@test "jsts: format_pre formats a .ts file in-process (async driver captures the response)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  [ -d "$REPO_ROOT/node_modules/prettier" ] || skip "repo prettier not installed (run pnpm install)"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/node_modules"
  ln -s "$REPO_ROOT/node_modules/prettier" "$cwd/node_modules/prettier"
  run pre_tool_use_write_call "$cwd/a.ts" 'let x=1' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "let x = 1;\n"'
}

