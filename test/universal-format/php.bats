#!/usr/bin/env bats

# PHP (php-cs-fixer) case.

load 'test_helper'

setup() {
  common_setup
}

@test "php-cs-fixer on PATH -> reformats a .php file, caching disabled" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '<?php echo "hi";\n' > "$cwd/a.php"
  rec_stub php-cs-fixer
  run format_file_call "$cwd/a.php" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("php-cs-fixer reformatted a.php")'
  run rg_or_grep -F "php-cs-fixer fix --quiet --using-cache=no" "$RECORD"
  assert_success
}
