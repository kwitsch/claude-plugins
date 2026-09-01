#!/usr/bin/env bats

# The removal of the vendored bin/rtk binary and its .gitattributes markings. bin/rtk itself
# still exists, but only as a small committed PATH-bridge shell wrapper (see hook.bats and
# CLAUDE.md) — never the vendored binary again.

load 'test_helper'

setup() {
  common_setup
}

@test "bin/rtk is a small committed PATH-bridge wrapper, not the vendored binary" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/bin/rtk
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/bin/rtk$'
  [ -e "$PLUGIN/bin/rtk" ]
  run wc -c < "$PLUGIN/bin/rtk"
  assert_success
  [ "$output" -lt 2000 ]
  run head -n1 "$PLUGIN/bin/rtk"
  assert_output '#!/usr/bin/env bash'
  run grep -F '.local/bin/rtk' "$PLUGIN/bin/rtk"
  assert_success
}

@test ".gitattributes no longer marks plugins/linux-token-efficiency/bin/* " {
  run bash -c "grep -c 'plugins/linux-token-efficiency/bin/\\*' '$REPO_ROOT/.gitattributes' || true"
  assert_output '0'
}
