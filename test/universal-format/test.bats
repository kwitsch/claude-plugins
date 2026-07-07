#!/usr/bin/env bats

# Tests for the universal-format plugin (mcp-kind PostToolUse Write|Edit auto-formatter).

setup() {
  bats_require_minimum_version 1.5.0
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/universal-format"
  MCP_JSON="$PLUGIN/.mcp.json"
  HOOKS="$PLUGIN/hooks/hooks.json"
  SERVER="$PLUGIN/mcp/server.mjs"

  # Isolated PATH: only system tools symlinked in; formatter stubs added per test.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash env node jq cat rm mkdir mktemp dirname head grep; do
    src="$(command -v "$t" 2>/dev/null)" && [ -n "$src" ] && ln -s "$src" "$MOCKBIN/$t"
  done

  # Isolated HOME so no test reads real user config.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude"
}

# --- scaffold invariants ---------------------------------------------------

@test "plugin.json is valid JSON with name/version/userConfig.auto_format" {
  run jq -e '.name == "universal-format" and (.version | type == "string") and (.userConfig.auto_format.type == "boolean") and (.userConfig.auto_format.default == true)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin is registered in marketplace.json without a version field" {
  run jq -e '[.plugins[] | select(.name == "universal-format" and .source == "./plugins/universal-format")] | length == 1' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
  run jq -e '[.plugins[] | select(.name == "universal-format") | has("version")] | any | not' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "plugin has a root README table row" {
  run grep -F "[universal-format](plugins/universal-format/README.md)" "$REPO_ROOT/README.md"
  assert_success
}

@test "plugin is in the test.yml matrix" {
  run grep -E "^\s*-\s*universal-format\s*$" "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}

@test ".mcp.json is valid JSON and registers universal-format-hooks -> mcp/server.mjs" {
  run jq -e '.mcpServers["universal-format-hooks"].command | endswith("mcp/server.mjs")' "$MCP_JSON"
  assert_success
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS"
  assert_success
}

@test "PostToolUse hook is wired to the namespaced format_file mcp_tool with timeout 60" {
  run jq -e '.hooks.PostToolUse[0] | .matcher == "Write|Edit" and (.hooks[0].type == "mcp_tool") and (.hooks[0].server == "plugin:universal-format:universal-format-hooks") and (.hooks[0].tool == "format_file") and (.hooks[0].timeout == 60)' "$HOOKS"
  assert_success
}

@test "every mcp_tool hook references a configured server (namespaced key)" {
  run bash -c '
    set -e
    for s in $(jq -r "[.hooks[][].hooks[] | select(.type==\"mcp_tool\") | .server] | unique[]" "'"$HOOKS"'"); do
      key="${s##*:}"   # strip plugin:<plugin>: namespace prefix -> bare .mcp.json key
      jq -e --arg k "$key" ".mcpServers[\$k]" "'"$MCP_JSON"'" >/dev/null \
        || { echo "server not configured: $s (key $key)" >&2; exit 1; }
    done
  '
  assert_success
}

@test "every mcp_tool hook names a non-empty tool" {
  run jq -e '[.hooks[][].hooks[] | select(.type=="mcp_tool")] | all(.tool | type=="string" and length>0)' "$HOOKS"
  assert_success
}

@test "server.mjs is executable (repo rule)" {
  [ -x "$SERVER" ]
}

@test "server.mjs has a node shebang" {
  run head -n1 "$SERVER"
  assert_output '#!/usr/bin/env node'
}

@test "server.mjs passes node --check" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run node --check "$SERVER"
  assert_success
}

@test "server lists format_file over stdio" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run bash -c '
    printf "%s\n%s\n" \
      "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" \
      "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" \
      | node "'"$SERVER"'"
  '
  assert_success
  assert_output --partial '"format_file"'
}

@test "plugin README first ## heading is Install" {
  run bash -c "grep -m1 '^## ' '$PLUGIN/README.md'"
  assert_success
  assert_output "## Install"
}

@test "plugin README contains the install command" {
  run grep -F "/plugin install universal-format@kwitsch-plugins" "$PLUGIN/README.md"
  assert_success
}

@test "plugin README has no ## Hooks section" {
  run grep -E "^## Hooks" "$PLUGIN/README.md"
  assert_failure
}
