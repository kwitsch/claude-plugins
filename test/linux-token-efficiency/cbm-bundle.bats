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

@test "hooks.json keeps the rtk entry and adds exactly four cbm handlers" {
  run jq empty "$HOOKS"
  assert_success
  run jq -e '[.hooks.PreToolUse[] | select(.matcher == "Bash") | .hooks[0].command] == ["${CLAUDE_PLUGIN_ROOT}/hooks/rtk-rewrite.mjs"]' "$HOOKS"
  assert_success
  run jq -e '[.hooks | to_entries[] | .value[] | .hooks[] | select(.command | test("cbm-context.mjs"))] | length == 4' "$HOOKS"
  assert_success
  run jq -e '[.hooks | to_entries[] | .value[] | .hooks[] | select(.command | test("cbm-context.mjs")) | .type == "command" and .timeout == 21 and (has("args") | not) and (has("async") | not)] | all' "$HOOKS"
  assert_success
  run jq -e '(.hooks.SessionStart | length) == 1 and (.hooks.SubagentStart | length) == 1' "$HOOKS"
  assert_success
  run jq -e '.hooks.SessionStart[0] | has("matcher") | not' "$HOOKS"
  assert_success
  run jq -e '.hooks.SubagentStart[0] | has("matcher") | not' "$HOOKS"
  assert_success
  run jq -e '[.hooks.PreToolUse[] | select(.matcher == "Grep|Glob") | .hooks[0].command] == ["${CLAUDE_PLUGIN_ROOT}/hooks/cbm-context.mjs"]' "$HOOKS"
  assert_success
  run jq -e '[.hooks.PostToolUse[] | select(.matcher == "Read") | .hooks[0].command] == ["${CLAUDE_PLUGIN_ROOT}/hooks/cbm-context.mjs"]' "$HOOKS"
  assert_success
  run grep -F 'node ' "$HOOKS"
  assert_failure
  run grep -F 'user_config' "$HOOKS"
  assert_failure
}

@test "mcp/cbm-context.mjs is tracked as a non-executable helper module (100644)" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/mcp/cbm-context.mjs
  assert_success
  assert_line --regexp '^100644 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/mcp/cbm-context\.mjs$'
  run head -c 2 "$CBM_HELPERS"
  refute_output '#!'
  run node --check "$CBM_HELPERS"
  assert_success
}

@test "the plugin sets only its own two CBM_ variables" {
  # Only env-name positions count (`CBM_X=` in shell, `"CBM_X":` in JSON / a JS object
  # literal). The leading non-word-char guard excludes the CLAUDE_PLUGIN_OPTION_CBM_ENABLED
  # suffix, and cbm-context.mjs's CBM_SPAWN_TIMEOUT_MS / CBM_MAX_OUTPUT_BYTES are
  # module-local constants (`NAME = value`), never environment variables.
  run bash -c "grep -rhoE '(^|[^A-Za-z0-9_])CBM_[A-Z_]+[=:]' '$MCP_JSON' '$PLUGIN/hooks/' '$PLUGIN/bin/cbm-launch.sh' | grep -oE 'CBM_[A-Z_]+' | sort -u | tr '\n' ' '"
  assert_output 'CBM_BUNDLE_CACHE CBM_NO_EXTRACT '
}

@test "no file in the plugin ever assigns the upstream-owned CBM_CACHE_DIR" {
  run bash -c "grep -rnE 'CBM_CACHE_DIR[=:]' '$MCP_JSON' '$PLUGIN/hooks/' '$PLUGIN/bin/cbm-launch.sh'"
  assert_failure
}
