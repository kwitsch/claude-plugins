#!/usr/bin/env bats

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/universal-lint"
  MCP_JSON="$PLUGIN/.mcp.json"
  HOOKS="$PLUGIN/hooks/hooks.json"
  SERVER="$PLUGIN/mcp/server.mjs"
}

@test ".mcp.json is valid JSON" {
  run jq empty "$MCP_JSON"
  assert_success
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS"
  assert_success
}

@test "every mcp_tool hook references a configured server (namespaced key)" {
  run bash -c '
    set -e
    for s in $(jq -r "[.hooks[][].hooks[] | select(.type==\"mcp_tool\") | .server] | unique[]" "'"$HOOKS"'"); do
      key="${s##*:}"
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

@test "server.mjs is executable" {
  [ -x "$SERVER" ]
}

@test "server.mjs has a node shebang" {
  run head -n1 "$SERVER"
  assert_output '#!/usr/bin/env node'
}

@test "server.mjs passes node --check" {
  run node --check "$SERVER"
  assert_success
}

@test "server lists its tool over stdio" {
  run bash -c '
    printf "%s\n%s\n" \
      "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" \
      "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" \
      | node "'"$SERVER"'"
  '
  assert_success
  assert_output --partial '"lint_file"'
}
