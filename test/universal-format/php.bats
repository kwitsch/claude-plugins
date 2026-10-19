#!/usr/bin/env bats

# .php through format_pre and the bundled @prettier/plugin-php. The php-cs-fixer chain is gone;
# the last test is the tripwire.

load 'test_helper'

setup() {
  common_setup
}

@test "php: format_pre formats a .php file with the bundled prettier" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.php" '<?php  echo "hi";' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "<?php echo \"hi\";\n"'
}

@test "php: a php-cs-fixer stub on PATH is never run; the bundled plugin formats in-process" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  rec_stub php-cs-fixer
  run pre_tool_use_write_call "$cwd/a.php" '<?php  echo "hi";' "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "<?php echo \"hi\";\n"'
  [ ! -s "$RECORD" ]
}
