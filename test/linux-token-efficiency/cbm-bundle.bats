#!/usr/bin/env bats

# Committed cbm artifacts — linux-token-efficiency: the hand-maintained cbm-tools.json
# snapshot, the bin/ layout, .mcp.json wiring and mcp/ file modes. No version pin, no
# vendored binary — the runtime resolves the latest release against its checksums.txt.

load 'test_helper'

setup() {
  common_setup
}

@test "cbm-tools.json is a 15-tool snapshot" {
  run jq empty "$CBM_TOOLS"
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

@test "bin/ holds the context-mode launcher and the rtk PATH-bridge wrapper (never the vendored binary)" {
  run bash -c "git -C '$REPO_ROOT' ls-files -- plugins/linux-token-efficiency/bin/ | sort"
  assert_output "$(printf 'plugins/linux-token-efficiency/bin/context-mode-launch.sh\nplugins/linux-token-efficiency/bin/rtk')"
  run bash -c "ls -A '$PLUGIN/bin' | sort"
  assert_output "$(printf 'context-mode-launch.sh\nrtk')"
}

@test "no cbm artifact is tracked anywhere in the repo" {
  run bash -c "git -C '$REPO_ROOT' ls-files | grep -E 'cbm-launch\.sh|cbm-checksums\.txt|portable\.tar\.gz' | grep -c . || true"
  assert_output '0'
}

@test ".gitattributes no longer carries the linux-token-efficiency bin/* markings" {
  run bash -c "grep -c 'plugins/linux-token-efficiency/bin/\\*' '$REPO_ROOT/.gitattributes' || true"
  assert_output '0'
}

@test ".mcp.json registers codebase-memory and context-mode, codebase-memory still wrapper-less at mcp/server.mjs" {
  run jq empty "$MCP_JSON"
  assert_success
  run jq -e '.mcpServers | keys == ["codebase-memory","context-mode"]' "$MCP_JSON"
  assert_success
  run jq -e '.mcpServers["codebase-memory"] | .command == "${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs" and (has("args") | not)' "$MCP_JSON"
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

@test "mcp/cbm-context.mjs is tracked as a non-executable helper module (100644)" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/mcp/cbm-context.mjs
  assert_success
  assert_line --regexp '^100644 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/mcp/cbm-context\.mjs$'
  run head -c 2 "$CBM_HELPERS"
  refute_output '#!'
  run node --check "$CBM_HELPERS"
  assert_success
}

@test "mcp/server.mjs is an executable node program in the git index (100755)" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/mcp/server.mjs
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/mcp/server\.mjs$'
  run head -n 1 "$CBM_SERVER"
  assert_output '#!/usr/bin/env node'
  run node --check "$CBM_SERVER"
  assert_success
}

@test "the plugin sets only its own CBM_BUNDLE_CACHE, never the upstream CBM_CACHE_DIR" {
  # Only env-name positions count (`CBM_X=` in shell, `"CBM_X":` in JSON -- the optional `"?`
  # tolerates the closing quote a JSON key has before its colon). CBM_NO_EXTRACT is gone with
  # the launcher; CBM_DOWNLOAD_BASE_URL is only ever READ (process.env.CBM_…), never assigned,
  # so it does not appear here.
  run bash -c "grep -rhoE '(^|[^A-Za-z0-9_])CBM_[A-Z_]+\"?[=:]' '$MCP_JSON' '$PLUGIN/hooks/' '$PLUGIN/mcp/' | grep -oE 'CBM_[A-Z_]+' | sort -u | tr '\n' ' '"
  assert_output 'CBM_BUNDLE_CACHE '
  run bash -c "grep -rnE 'CBM_CACHE_DIR\"?[=:]' '$MCP_JSON' '$PLUGIN/hooks/' '$PLUGIN/mcp/'"
  assert_failure
  # Scoped to code, not docs: CLAUDE.md's own CBM_NO_EXTRACT mention is a Task 7 (doc sync)
  # cleanup, tracked separately by docs.bats.
  run bash -c "grep -rn 'CBM_NO_EXTRACT' '$MCP_JSON' '$PLUGIN/hooks/' '$PLUGIN/mcp/'"
  assert_failure
}
