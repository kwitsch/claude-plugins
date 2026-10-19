#!/usr/bin/env bats

# .vue single-file components through format_pre and the bundled prettier.

load 'test_helper'

setup() {
  common_setup
}

# Multi-line fixture in a helper, mirroring yaml.bats's long_yaml(). Command substitution strips
# the trailing newline; prettier adds it back, so the expected output is unaffected.
vue_sfc() {
  printf '<template><p>hi</p></template>\n\n<script setup>\nlet x=1\n</script>\n'
}

@test "vue: format_pre formats a .vue SFC with the bundled prettier" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  run pre_tool_use_write_call "$cwd/a.vue" "$(vue_sfc)" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "<template><p>hi</p></template>\n\n<script setup>\nlet x = 1;\n</script>\n"'
}

@test "vue: prettier and npx stubs on PATH are never run; the bundled prettier formats in-process" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  rec_stub prettier
  rec_stub npx
  run pre_tool_use_write_call "$cwd/a.vue" "$(vue_sfc)" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "<template><p>hi</p></template>\n\n<script setup>\nlet x = 1;\n</script>\n"'
  [ ! -s "$RECORD" ]
}
