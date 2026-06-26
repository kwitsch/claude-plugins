#!/usr/bin/env bats

PLUGIN="${BATS_TEST_DIRNAME}/../../plugins/shell-lsp"

@test "plugin.json is valid and has a version" {
  run jq -e '.name == "shell-lsp" and (.version | type == "string")' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
}

@test "plugin.json declares exactly the two userConfig toggles" {
  run jq -r '.userConfig | keys | sort | join(",")' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$output" = "enforce_read_gate,enforce_search" ]
}

@test "every userConfig description ends with its (Type, Default: value) suffix" {
  # Derive the required suffix per option from its own .type and .default:
  # capitalize the type, stringify the default -> "(<Type>, Default: <value>)".
  run jq -e '[.userConfig[] | . as $o | (($o.type | (.[0:1] | ascii_upcase) + .[1:])) as $cap | ("(" + $cap + ", Default: " + ($o.default | tostring) + ")") as $s | select(($o.description | endswith($s)) | not)] | length == 0' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
}

@test ".lsp.json maps only shell extensions (no .js/.ts)" {
  run jq -r '.bashls.extensionToLanguage | keys | sort | join(",")' "$PLUGIN/.lsp.json"
  [ "$output" = ".bash,.sh" ]
}

@test ".lsp.json never maps a JS/TS extension" {
  run jq -e '[.bashls.extensionToLanguage | keys[] | select(test("\\.[cm]?[jt]sx?$"))] | length == 0' "$PLUGIN/.lsp.json"
  [ "$status" -eq 0 ]
}

@test ".mcp.json launches the shell-lsp-hooks server via mcp/server.mjs directly (no wrapper, no args)" {
  run jq -e '.mcpServers["shell-lsp-hooks"] | (.command | test("\\$\\{CLAUDE_PLUGIN_ROOT\\}/mcp/server\\.mjs$")) and (has("args") | not)' "$PLUGIN/.mcp.json"
  [ "$status" -eq 0 ]
}

@test ".lsp.json launches bash-language-server via pinned npx with the start subcommand (no wrapper)" {
  run jq -e '.bashls | (.command == "npx") and (.args[0] == "-y") and ((.args | index("bash-language-server@5.6.0")) != null) and ((.args | index("start")) != null)' "$PLUGIN/.lsp.json"
  [ "$status" -eq 0 ]
}

@test "server.mjs has the node shebang (load-bearing for direct invocation)" {
  run head -1 "$PLUGIN/mcp/server.mjs"
  [ "$output" = "#!/usr/bin/env node" ]
}

@test "server.mjs has git mode 100755 (load-bearing for direct invocation)" {
  run git ls-tree HEAD "$PLUGIN/mcp/server.mjs"
  [[ "$output" == 100755* ]]
}

@test "no .sh launcher wrapper remains under bin/" {
  if [ -d "$PLUGIN/bin" ]; then
    run find "$PLUGIN/bin" -name '*.sh' -type f
    [ -z "$output" ]
  fi
}

@test "every mcp_tool handler uses the namespaced server" {
  # Universal across all events (not just Pre/Post): any mcp_tool handler must
  # carry the namespaced server. The SessionStart cat hook is type=command, so
  # it is excluded here and bounded by the command-hook test below.
  run jq -e '[.hooks[][]?.hooks[]? | select(.type == "mcp_tool" and .server != "plugin:shell-lsp:shell-lsp-hooks")] | length == 0' "$PLUGIN/hooks/hooks.json"
  [ "$status" -eq 0 ]
}

@test "the only command hook is the SessionStart cat hint (exec form)" {
  run jq -e '[.hooks[][]?.hooks[]? | select(.type == "command")] as $cmd | ($cmd | length == 1) and ($cmd[0].command == "cat") and ($cmd[0].args[0] | endswith("hooks/SessionStart.md"))' "$PLUGIN/hooks/hooks.json"
  [ "$status" -eq 0 ]
}

@test "SessionStart hook cats the bundled hint via exec form" {
  run jq -e '.hooks.SessionStart[0].hooks[0] | .type == "command" and .command == "cat" and (.args[0] | endswith("hooks/SessionStart.md"))' "$PLUGIN/hooks/hooks.json"
  [ "$status" -eq 0 ]
}

@test "SessionStart hint exists, non-empty, server-agnostic" {
  f="$PLUGIN/hooks/SessionStart.md"
  [ -s "$f" ]
  grep -q "LSP-first symbol search" "$f"
  grep -q "workspaceSymbol" "$f"
  run grep -qE "js-lsp|ts-lsp|shell-lsp" "$f"
  [ "$status" -ne 0 ]
}

@test "SessionStart.md is byte-identical across js-lsp, ts-lsp, shell-lsp" {
  base="${BATS_TEST_DIRNAME}/../../plugins"
  run cmp -s "$base/js-lsp/hooks/SessionStart.md" "$base/ts-lsp/hooks/SessionStart.md"
  [ "$status" -eq 0 ]
  run cmp -s "$base/js-lsp/hooks/SessionStart.md" "$base/shell-lsp/hooks/SessionStart.md"
  [ "$status" -eq 0 ]
}

@test "reentrancy: matchers never match the plugin's own hook tools" {
  run jq -e '[.hooks[][]?.matcher? // "" | select(test("hook_|mcp__plugin_shell-lsp"))] | length == 0' "$PLUGIN/hooks/hooks.json"
  [ "$status" -eq 0 ]
}

@test "PreToolUse + PostToolUse matchers are as designed" {
  run jq -r '.hooks.PreToolUse[0].matcher' "$PLUGIN/hooks/hooks.json"
  [ "$output" = "Grep|Glob|Bash|Read" ]
  run jq -r '.hooks.PostToolUse[0].matcher' "$PLUGIN/hooks/hooks.json"
  [ "$output" = "LSP" ]
}

@test "server.mjs is executable and passes node --check" {
  [ -x "$PLUGIN/mcp/server.mjs" ]
  run node --check "$PLUGIN/mcp/server.mjs"
  [ "$status" -eq 0 ]
}

@test "imported mcp modules pass node --check" {
  for m in handlers symbols state; do
    run node --check "$PLUGIN/mcp/$m.mjs"
    [ "$status" -eq 0 ]
  done
}

@test "server speaks JSON-RPC: initialize + tools/list lists the hook tools" {
  run bash -c 'printf "%s\n%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" | node "'"$PLUGIN"'/mcp/server.mjs"'
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "hook_pretooluse"
  echo "$output" | grep -q "hook_posttooluse"
}

@test "node --test units pass" {
  run node --test "${BATS_TEST_DIRNAME}"/*.test.mjs
  [ "$status" -eq 0 ]
}

