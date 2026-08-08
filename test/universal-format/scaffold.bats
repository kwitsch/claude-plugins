#!/usr/bin/env bats

# Scaffold invariants for the universal-format plugin (MCP-server architecture).

load 'test_helper'

setup() {
  common_setup
}

@test "plugin.json is valid JSON with name/version and no userConfig (deliberate — see CLAUDE.md)" {
  run jq -e '.name == "universal-format" and (.version | type == "string") and (has("userConfig") | not)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin is registered in marketplace.json without a version field" {
  run jq -e '[.plugins[] | select(.name == "universal-format" and .source == "./plugins/universal-format")] | length == 1' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
  run jq -e '[.plugins[] | select(.name == "universal-format") | has("version")] | any | not' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "plugin has a root README table row" {
  run rg_or_grep -F "[universal-format](plugins/universal-format/README.md)" "$REPO_ROOT/README.md"
  assert_success
}

@test "plugin is in the test.yml matrix" {
  run rg_or_grep -E "^\s*-\s*universal-format\s*$" "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS"
  assert_success
}

@test "PreToolUse hook -> format_pre mcp_tool, matcher Write|Edit, timeout 60, not async" {
  run jq -e '.hooks.PreToolUse[0] | .matcher == "Write|Edit" and (.hooks[0].type == "mcp_tool") and (.hooks[0].server == "plugin:universal-format:universal-format-hooks") and (.hooks[0].tool == "format_pre") and (.hooks[0].timeout == 60) and ((.hooks[0].async // false) == false)' "$HOOKS"
  assert_success
}

@test "PostToolUse hook -> format_post mcp_tool, matcher Write|Edit, timeout 60, not async" {
  run jq -e '.hooks.PostToolUse[0] | .matcher == "Write|Edit" and (.hooks[0].type == "mcp_tool") and (.hooks[0].server == "plugin:universal-format:universal-format-hooks") and (.hooks[0].tool == "format_post") and (.hooks[0].timeout == 60) and ((.hooks[0].async // false) == false)' "$HOOKS"
  assert_success
}

@test ".mcp.json wires universal-format-hooks -> wrapper + server + CLAUDE_PLUGIN_DATA env" {
  run jq -e '.mcpServers["universal-format-hooks"] | (.command | endswith("bin/mjs-launch.sh")) and (.args[0] | endswith("mcp/server.mjs")) and (.env.CLAUDE_PLUGIN_DATA == "${CLAUDE_PLUGIN_DATA}")' "$MCP_JSON"
  assert_success
}

@test "bin/mjs-launch.sh is executable with a bash shebang and passes bash -n" {
  [ -x "$WRAPPER" ]
  run head -n1 "$WRAPPER"
  assert_output '#!/usr/bin/env bash'
  run bash -n "$WRAPPER"
  assert_success
}

@test "bin/mjs-launch.sh uses the no-empty-segment PATH form and errors (exit 64) on missing arg" {
  run rg_or_grep -F '${PATH:+${PATH}:}' "$WRAPPER"
  assert_success
  run "$WRAPPER"
  assert_failure 64
  assert_output --partial "missing argument"
}

@test "mcp/server.mjs is executable, node-shebanged, and passes node --check" {
  [ -x "$SERVER" ]
  run head -n1 "$SERVER"
  assert_output '#!/usr/bin/env node'
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run node --check "$SERVER"
  assert_success
}

@test "tools/list lists both format_pre and format_post, and the server exits" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run bash -c '
    printf "%s\n%s\n" \
      "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" \
      "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" \
    | node "'"$SERVER"'"
  '
  assert_success
  assert_output --partial '"format_pre"'
  assert_output --partial '"format_post"'
}

@test "format_post on an unsupported extension over JSON-RPC returns {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'hi\n' > "$cwd/z.txt"
  run format_file_call "$cwd/z.txt" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "hooks/format-file.mjs no longer exists; hooks/ contains only hooks.json" {
  [ ! -e "$PLUGIN/hooks/format-file.mjs" ]
  run bash -c "ls -1 '$PLUGIN/hooks'"
  assert_output "hooks.json"
}

@test "plugin README first ## heading is Install" {
  run bash -c "rg_or_grep -m1 '^## ' '$PLUGIN/README.md'"
  assert_success
  assert_output "## Install"
}

@test "plugin README contains the install command" {
  run rg_or_grep -F "/plugin install universal-format@kwitsch-plugins" "$PLUGIN/README.md"
  assert_success
}

@test "plugin README has no ## Hooks section" {
  run rg_or_grep -E "^## Hooks" "$PLUGIN/README.md"
  assert_failure
}

@test "plugin.json version is 0.9.0" {
  run jq -e '.version == "0.9.0"' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}
