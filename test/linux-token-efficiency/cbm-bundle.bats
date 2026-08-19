#!/usr/bin/env bats

# Committed cbm tarball + cbm-bundle.json pin + cbm-checksums.txt sidecar —
# linux-token-efficiency. Never extracts the real 279.6 MiB binary.

load 'test_helper'

setup() {
  common_setup
}

@test "cbm-bundle.json pins codebase-memory-mcp 0.10.1 and the portable asset, with no committed path" {
  run jq -e '.cbmVersion == "0.10.1" and .upstreamRepo == "DeusData/codebase-memory-mcp" and .releaseTag == "v0.10.1"' "$CBM_PIN"
  assert_success
  run jq -e '.releaseTag == "v" + .cbmVersion' "$CBM_PIN"
  assert_success
  run jq -e '(.binaries | length) == 1 and (.binaries[0] | has("path") | not) and .binaries[0].asset == "codebase-memory-mcp-linux-amd64-portable.tar.gz"' "$CBM_PIN"
  assert_success
  run jq -e '.binaries[0] | (.assetSha256 | test("^[0-9a-f]{64}$")) and (.binarySha256 | test("^[0-9a-f]{64}$"))' "$CBM_PIN"
  assert_success
  run jq -e '.binaries[0].assetSha256 == "97c6580a13d772d040e936584f3c5234586ab03f31a77354af8a763851a39a7f" and .binaries[0].binarySha256 == "3380cf3b868d749c63f564e7c6b81381a140942ec42253f785e158ab5144064f"' "$CBM_PIN"
  assert_success
}

@test "cbm-tools.json is a 15-tool snapshot pinned to the same cbm version" {
  run jq empty "$CBM_TOOLS"
  assert_success
  run jq -e --slurpfile pin "$CBM_PIN" '.cbmVersion == $pin[0].cbmVersion' "$CBM_TOOLS"
  assert_success
  run jq -e '(.tools | length) == 15' "$CBM_TOOLS"
  assert_success
  run jq -e '.tools | all((.name | type == "string" and length > 0) and (.description | type == "string" and length > 0) and (.inputSchema | type == "object") and (.inputSchema.type == "object"))' "$CBM_TOOLS"
  assert_success
  run jq -e '[.tools[].name] | sort == unique' "$CBM_TOOLS"
  assert_success
  # Collision guard: the four proxy-local hook tools own the hook_ prefix.
  run jq -e '[.tools[].name] | all(startswith("hook_") | not)' "$CBM_TOOLS"
  assert_success
  run jq -e '[.tools[].name] | sort == (["index_repository","search_graph","query_graph","trace_path","get_code_snippet","get_graph_schema","get_architecture","search_code","list_projects","delete_project","index_status","check_index_coverage","detect_changes","manage_adr","ingest_traces"] | sort)' "$CBM_TOOLS"
  assert_success
}

@test "bin/ holds the committed rtk binary and the context-mode launcher" {
  run bash -c "git -C '$REPO_ROOT' ls-files -- plugins/linux-token-efficiency/bin/"
  assert_output 'plugins/linux-token-efficiency/bin/context-mode-launch.sh
plugins/linux-token-efficiency/bin/rtk'
  run bash -c "ls -A '$PLUGIN/bin'"
  assert_output 'context-mode-launch.sh
rtk'
}

@test "no cbm artifact is tracked anywhere in the repo" {
  run bash -c "git -C '$REPO_ROOT' ls-files | grep -E 'cbm-launch\.sh|cbm-checksums\.txt|portable\.tar\.gz' | grep -c . || true"
  assert_output '0'
}

@test ".gitattributes still marks bin/ as binary data for the rtk binary" {
  run grep -F -- 'plugins/linux-token-efficiency/bin/* binary' "$REPO_ROOT/.gitattributes"
  assert_success
  run git -C "$REPO_ROOT" check-attr binary -- plugins/linux-token-efficiency/bin/rtk
  assert_success
  assert_output --partial 'binary: set'
}

@test ".gitattributes marks the committed mcp ELF as binary data" {
  run grep -F -- 'plugins/linux-token-efficiency/mcp/linux-token-efficiency-mcp binary' "$REPO_ROOT/.gitattributes"
  assert_success
  run git -C "$REPO_ROOT" check-attr binary -- plugins/linux-token-efficiency/mcp/linux-token-efficiency-mcp
  assert_success
  assert_output --partial 'binary: set'
}

@test ".mcp.json registers codebase-memory and context-mode, codebase-memory wrapper-less at mcp/linux-token-efficiency-mcp" {
  run jq empty "$MCP_JSON"
  assert_success
  run jq -e '.mcpServers | keys == ["codebase-memory","context-mode"]' "$MCP_JSON"
  assert_success
  run jq -e '.mcpServers["codebase-memory"] | .command == "${CLAUDE_PLUGIN_ROOT}/mcp/linux-token-efficiency-mcp" and (has("args") | not)' "$MCP_JSON"
  assert_success
  run jq -e '.mcpServers["codebase-memory"].env | keys == ["CBM_BUNDLE_CACHE","CLAUDE_PLUGIN_OPTION_CBM_ENABLED"] and .CLAUDE_PLUGIN_OPTION_CBM_ENABLED == "${user_config.cbm_enabled}" and .CBM_BUNDLE_CACHE == "${CLAUDE_PLUGIN_DATA}/cbm"' "$MCP_JSON"
  assert_success
  run grep -F 'CBM_CACHE_DIR' "$MCP_JSON"
  assert_failure
  run grep -F 'CBM_NO_EXTRACT' "$MCP_JSON"
  assert_failure
  run grep -F 'mjs-launch.sh' "$MCP_JSON"
  assert_failure
}

@test "mcp/linux-token-efficiency-mcp is a committed executable ELF binary in the git index (100755)" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/mcp/linux-token-efficiency-mcp
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/mcp/linux-token-efficiency-mcp$'
  run bash -c "head -c 4 '$CBM_BINARY' | od -An -tx1"
  assert_output --partial '7f 45 4c 46'
}

@test "the committed Rust binary is tracked 100755 and reports the plugin version" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/mcp/linux-token-efficiency-mcp
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/mcp/linux-token-efficiency-mcp$'
  [ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ] || skip "not linux-x64"
  run "$CBM_BINARY" --version
  assert_success
  run bash -c "'$CBM_BINARY' --version | tr -d '[:space:]'"
  assert_output "$(jq -r .version "$MANIFEST")"
}

@test "the plugin sets only its own CBM_BUNDLE_CACHE, never the upstream CBM_CACHE_DIR" {
  # Only env-name positions count (`CBM_X=` in shell, `"CBM_X":` in JSON -- the optional `"?`
  # tolerates the closing quote a JSON key has before its colon). CBM_NO_EXTRACT is gone with
  # the launcher; CBM_DOWNLOAD_BASE_URL is only ever READ (process.env.CBM_…), never assigned,
  # so it does not appear here. mcp/ now holds only the committed ELF binary (no text to scan);
  # every CBM_ assignment lives in .mcp.json, so the scan targets .mcp.json and hooks/ only.
  run bash -c "grep -rhoE '(^|[^A-Za-z0-9_])CBM_[A-Z_]+\"?[=:]' '$MCP_JSON' '$PLUGIN/hooks/' | grep -oE 'CBM_[A-Z_]+' | sort -u | tr '\n' ' '"
  assert_output 'CBM_BUNDLE_CACHE '
  run bash -c "grep -rnE 'CBM_CACHE_DIR\"?[=:]' '$MCP_JSON' '$PLUGIN/hooks/'"
  assert_failure
  # Scoped to code, not docs: CLAUDE.md's own CBM_NO_EXTRACT mention is a Task 7 (doc sync)
  # cleanup, tracked separately by docs.bats.
  run bash -c "grep -rn 'CBM_NO_EXTRACT' '$MCP_JSON' '$PLUGIN/hooks/'"
  assert_failure
}
