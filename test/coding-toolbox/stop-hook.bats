#!/usr/bin/env bats

# Stop hook / interaction_gate mechanical Interaction-axis gate — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "Stop hook has no matcher and is wired to the interaction_gate mcp_tool" {
  run jq -e '.hooks.Stop[0] | (has("matcher") | not) and (.hooks[0].type == "mcp_tool") and (.hooks[0].server == "plugin:coding-toolbox:coding-toolbox-hooks") and (.hooks[0].tool == "interaction_gate")' "$HOOKS/hooks.json"
  assert_success
}

# Drive the interaction_gate MCP tool with one last_assistant_message. Echoes the
# tools/call structuredContent JSON.
interaction_gate_call() {
  local msg="$1"
  {
    printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
    printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"interaction_gate","arguments":{"hook_event_name":"Stop","last_assistant_message":%s}}}\n' "$(jq -Rs . <<< "$msg")"
  } | node "$PLUGIN/mcp/server.mjs" 2>/dev/null \
    | jq -c 'select(.id == 2) | .result.structuredContent'
}
@test "interaction_gate blocks when the final line ends in a bare '?'" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  run interaction_gate_call $'Done here.\nWant me to X or Y?'
  assert_success
  echo "$output" | jq -e '.decision == "block" and (.reason | length > 0)'
}
@test "interaction_gate allows a normal final line" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  run interaction_gate_call "All done. Summary above."
  assert_success
  [ "$output" = "{}" ]
}
