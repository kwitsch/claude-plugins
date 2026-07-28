#!/usr/bin/env bats

# biome/prettier chain, native-config precedence, npx fallback.

load 'test_helper'

setup() {
  common_setup
}

@test "jsts: biome.json native config beats .editorconfig -> biome runs bare (no mapped flags)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  printf '{}\n' > "$cwd/biome.json"
  printf 'root = true\n[*]\nindent_style = space\nindent_size = 2\n' > "$cwd/.editorconfig"
  rec_stub biome
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  run rg_or_grep -F -- "--indent-style" "$RECORD"
  assert_failure
  run rg_or_grep -F "biome " "$RECORD"
  assert_success
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

@test "jsts: prettier and biome both absent, npx also absent -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "jsts: biome on PATH, prettier absent, npx present -> biome wins (native beats npx-only)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  rec_stub biome
  rec_stub npx   # present but must not be used -- biome is genuinely installed
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  run rg_or_grep -E "^biome " "$RECORD"
  assert_success
  run rg_or_grep -F "npx" "$RECORD"
  assert_failure
}

