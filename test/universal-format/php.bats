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

@test "php: format_post returns {} with a php-cs-fixer stub present but never run" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '<?php echo "hi";\n' > "$cwd/a.php"
  rec_stub php-cs-fixer
  run format_file_call "$cwd/a.php" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}
