#!/usr/bin/env bats

# PHP (php-cs-fixer/phpcbf) chain-order case.

load 'test_helper'

setup() {
  common_setup
}

@test "php-cs-fixer on PATH -> reformats a .php file" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '<?php echo "hi";\n' > "$cwd/a.php"
  rec_stub php-cs-fixer
  run format_file_call "$cwd/a.php" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("php-cs-fixer reformatted a.php")'
  run rg_or_grep -F "php-cs-fixer fix --quiet" "$RECORD"
  assert_success
}

@test "php-cs-fixer absent, phpcbf on PATH -> fallback runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '<?php echo "hi";\n' > "$cwd/a.php"
  rec_stub phpcbf
  run format_file_call "$cwd/a.php" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("phpcbf reformatted a.php")'
  run rg_or_grep -F "phpcbf " "$RECORD"
  assert_success
}
