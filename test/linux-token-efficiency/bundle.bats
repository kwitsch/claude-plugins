#!/usr/bin/env bats

# rtk-bundle.json pin + the removal of the vendored bin/rtk and its .gitattributes markings.

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

@test "the vendored bin/rtk is no longer tracked in git" {
  run bash -c "git -C '$REPO_ROOT' ls-files -- plugins/linux-token-efficiency/bin/rtk | grep -c . || true"
  assert_output '0'
  [ ! -e "$PLUGIN/bin/rtk" ]
}

@test ".gitattributes no longer marks plugins/linux-token-efficiency/bin/* " {
  run bash -c "grep -c 'plugins/linux-token-efficiency/bin/\\*' '$REPO_ROOT/.gitattributes' || true"
  assert_output '0'
}
