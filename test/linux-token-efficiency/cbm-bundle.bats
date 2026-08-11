#!/usr/bin/env bats

# Committed cbm tarball + cbm-bundle.json pin + cbm-checksums.txt sidecar —
# linux-token-efficiency. Never extracts the real 279.6 MiB binary.

load 'test_helper'

setup() {
  common_setup
}

@test "cbm-bundle.json pins codebase-memory-mcp 0.10.1 and the portable tarball" {
  run jq -e '.cbmVersion == "0.10.1" and .upstreamRepo == "DeusData/codebase-memory-mcp" and .releaseTag == "v0.10.1"' "$CBM_PIN"
  assert_success
  run jq -e '(.binaries | length) == 1 and .binaries[0].path == "bin/codebase-memory-mcp-linux-amd64-portable.tar.gz" and .binaries[0].asset == "codebase-memory-mcp-linux-amd64-portable.tar.gz"' "$CBM_PIN"
  assert_success
  run jq -e '.binaries[0].assetSha256 == "97c6580a13d772d040e936584f3c5234586ab03f31a77354af8a763851a39a7f" and .binaries[0].binarySha256 == "3380cf3b868d749c63f564e7c6b81381a140942ec42253f785e158ab5144064f"' "$CBM_PIN"
  assert_success
}

@test "binaries[0].path resolves to the committed tarball and matches assetSha256" {
  local target actual expected
  target="$PLUGIN/$(jq -r '.binaries[0].path' "$CBM_PIN")"
  [ -f "$target" ]
  actual="$(sha256sum < "$target" | cut -d' ' -f1)"
  expected="$(jq -r '.binaries[0].assetSha256' "$CBM_PIN")"
  [ "$actual" = "$expected" ]
}

@test "the committed tarball has the upstream byte size" {
  run stat -c %s "$CBM_TARBALL"
  assert_output '39482833'
}

@test "cbm-checksums.txt has exactly two entries agreeing with the pin" {
  [ -f "$CBM_SUMS" ]
  run bash -c "grep -c . '$CBM_SUMS'"
  assert_output '2'
  local asset_sha bin_sha
  asset_sha="$(awk '$2 == "codebase-memory-mcp-linux-amd64-portable.tar.gz" { print $1 }' "$CBM_SUMS")"
  bin_sha="$(awk '$2 == "codebase-memory-mcp" { print $1 }' "$CBM_SUMS")"
  [ "$asset_sha" = "$(jq -r '.binaries[0].assetSha256' "$CBM_PIN")" ]
  [ "$bin_sha" = "$(jq -r '.binaries[0].binarySha256' "$CBM_PIN")" ]
}

@test "the sidecar's tarball entry verifies from the bin directory" {
  run bash -c "cd '$PLUGIN/bin' && awk '\$2 == \"codebase-memory-mcp-linux-amd64-portable.tar.gz\"' cbm-checksums.txt | sha256sum --check --status -"
  assert_success
}

@test "the committed tarball is tracked as data (100644) and marked binary" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/bin/codebase-memory-mcp-linux-amd64-portable.tar.gz
  assert_success
  assert_line --regexp '^100644 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/bin/codebase-memory-mcp-linux-amd64-portable\.tar\.gz$'
  run git -C "$REPO_ROOT" check-attr binary -- plugins/linux-token-efficiency/bin/codebase-memory-mcp-linux-amd64-portable.tar.gz
  assert_success
  assert_output --partial 'binary: set'
}

@test "bin/cbm-launch.sh is executable in the git index (100755)" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/bin/cbm-launch.sh
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/bin/cbm-launch\.sh$'
}

@test ".gitattributes re-asserts text handling for the bin/ shell launcher" {
  run grep -F -- 'plugins/linux-token-efficiency/bin/*.sh text eol=lf diff merge' "$REPO_ROOT/.gitattributes"
  assert_success
  run git -C "$REPO_ROOT" check-attr text diff -- plugins/linux-token-efficiency/bin/cbm-launch.sh
  assert_success
  assert_output --partial 'text: set'
  assert_output --partial 'diff: set'
}

@test ".mcp.json registers exactly one codebase-memory stdio server via the launcher" {
  run jq empty "$MCP_JSON"
  assert_success
  run jq -e '.mcpServers | keys == ["codebase-memory"]' "$MCP_JSON"
  assert_success
  run jq -e '.mcpServers["codebase-memory"] | .command == "${CLAUDE_PLUGIN_ROOT}/bin/cbm-launch.sh" and (has("args") | not)' "$MCP_JSON"
  assert_success
  run jq -e '.mcpServers["codebase-memory"].env | keys == ["CBM_BUNDLE_CACHE","CLAUDE_PLUGIN_OPTION_CBM_ENABLED"] and .CLAUDE_PLUGIN_OPTION_CBM_ENABLED == "${user_config.cbm_enabled}" and .CBM_BUNDLE_CACHE == "${CLAUDE_PLUGIN_DATA}/cbm"' "$MCP_JSON"
  assert_success
  run grep -F 'CBM_CACHE_DIR' "$MCP_JSON"
  assert_failure
  run grep -F 'CBM_NO_EXTRACT' "$MCP_JSON"
  assert_failure
}
