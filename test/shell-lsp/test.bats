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

@test ".lsp.json launches via the bash-ls launcher with the start subcommand" {
  run jq -r '.bashls.command' "$PLUGIN/.lsp.json"; [[ "$output" == *"/bin/bash-ls-launch.sh" ]]
  run jq -r '.bashls.args | join(" ")' "$PLUGIN/.lsp.json"; [ "$output" = "start" ]
}

@test "bash-ls-launch.sh is executable and passes bash -n" {
  [ -x "$PLUGIN/bin/bash-ls-launch.sh" ]
  run bash -n "$PLUGIN/bin/bash-ls-launch.sh"
  [ "$status" -eq 0 ]
}

@test "bash-ls-launch.sh prepends ~/.bun/bin so a bun-installed server is found on a minimal PATH" {
  tmp="$BATS_TEST_TMPDIR/bunhome"
  mkdir -p "$tmp/.bun/bin"
  cat > "$tmp/.bun/bin/bash-language-server" <<'EOF'
#!/usr/bin/env bash
echo "BASHLS_STUB_OK:$1"
EOF
  chmod +x "$tmp/.bun/bin/bash-language-server"
  run env -i HOME="$tmp" PATH="/usr/bin:/bin" bash "$PLUGIN/bin/bash-ls-launch.sh" start
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "BASHLS_STUB_OK:start"
}

@test ".mcp.json registers the shell-lsp-hooks server" {
  run jq -e '.mcpServers["shell-lsp-hooks"].command | test("server\\.mjs$")' "$PLUGIN/.mcp.json"
  [ "$status" -eq 0 ]
}

@test "every PreToolUse/PostToolUse handler is mcp_tool with the namespaced server" {
  run jq -e '[.hooks.PreToolUse[], .hooks.PostToolUse[] | .hooks[] | select(.type != "mcp_tool" or .server != "plugin:shell-lsp:shell-lsp-hooks")] | length == 0' "$PLUGIN/hooks/hooks.json"
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
  run bash -c 'printf "%s\n%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" | SHELL_LSP_NO_BUN=1 node "'"$PLUGIN"'/mcp/server.mjs"'
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "hook_pretooluse"
  echo "$output" | grep -q "hook_posttooluse"
}

@test "node --test units pass" {
  run node --test "${BATS_TEST_DIRNAME}"/*.test.mjs
  [ "$status" -eq 0 ]
}
