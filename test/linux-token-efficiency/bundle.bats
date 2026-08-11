#!/usr/bin/env bats

# Committed rtk binary + rtk-bundle.json pin + .gitattributes — linux-token-efficiency.

load 'test_helper'

setup() {
  common_setup
}

@test "rtk-bundle.json pins rtk 0.45.0 and the musl asset" {
  run jq -e '.rtkVersion == "0.45.0" and .upstreamRepo == "rtk-ai/rtk" and .releaseTag == "v0.45.0"' "$PIN"
  assert_success
  run jq -e '(.binaries | length) == 1 and .binaries[0].path == "bin/rtk" and .binaries[0].asset == "rtk-x86_64-unknown-linux-musl.tar.gz"' "$PIN"
  assert_success
  run jq -e '.binaries[0].assetSha256 == "c4c036fbf181fc55ef329786c8c17e0d427972b053b825944d968a6aafef1ba4"' "$PIN"
  assert_success
}

@test "the committed binary matches the pin's binarySha256" {
  [ -f "$PLUGIN/bin/rtk" ]
  local actual expected
  actual="$(sha256sum < "$PLUGIN/bin/rtk" | cut -d' ' -f1)"
  expected="$(jq -r '.binaries[0].binarySha256' "$PIN")"
  [ "$actual" = "$expected" ]
}

@test "bin/rtk is executable in the git index (100755)" {
  # Reads the INDEX (what `git update-index --chmod=+x` writes), not the committed
  # tree -- this suite runs before the adding commit exists, so `git ls-tree HEAD`
  # would false-fail here even once the file is staged correctly.
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/bin/rtk
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/bin/rtk$'
}

@test ".gitattributes marks the bundled binaries as binary" {
  run grep -F -- 'plugins/linux-token-efficiency/bin/* binary' "$REPO_ROOT/.gitattributes"
  assert_success
  run git -C "$REPO_ROOT" check-attr binary -- plugins/linux-token-efficiency/bin/rtk
  assert_success
  assert_output --partial 'binary: set'
}

@test "the committed binary reports the pinned version on an x86_64 Linux host" {
  [ "$(uname -s)" = "Linux" ] || skip "not a Linux host"
  [ "$(uname -m)" = "x86_64" ] || skip "not an x86_64 host"
  run "$PLUGIN/bin/rtk" --version
  assert_success
  assert_output --partial "$(jq -r '.rtkVersion' "$PIN")"
}
