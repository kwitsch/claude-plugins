#!/usr/bin/env bats

# rtk-bundle.json pin + the removal of the vendored bin/rtk binary and its .gitattributes
# markings. bin/rtk itself still exists, but only as a small committed PATH-bridge shell
# wrapper (see hook.bats and CLAUDE.md) — never the vendored binary again.

load 'test_helper'

setup() {
  common_setup
}

@test "rtk-bundle.json pins rtk 0.45.0 and the musl asset, with no binaries[].path" {
  run jq -e '.rtkVersion == "0.45.0" and .upstreamRepo == "rtk-ai/rtk" and .releaseTag == "v0.45.0"' "$PIN"
  assert_success
  run jq -e '(.binaries | length) == 1 and .binaries[0].asset == "rtk-x86_64-unknown-linux-musl.tar.gz"' "$PIN"
  assert_success
  run jq -e '.binaries[0] | has("path") | not' "$PIN"
  assert_success
  run jq -e '.binaries[0].assetSha256 == "c4c036fbf181fc55ef329786c8c17e0d427972b053b825944d968a6aafef1ba4"' "$PIN"
  assert_success
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
