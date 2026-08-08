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

@test ".mcp.json wires universal-format-hooks -> wrapper + server, with no env block" {
  run jq -e '.mcpServers["universal-format-hooks"] | (.command | endswith("bin/mjs-launch.sh")) and (.args[0] | endswith("mcp/server.mjs")) and (has("env") | not)' "$MCP_JSON"
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

@test "plugin.json version is 0.10.0" {
  run jq -e '.version == "0.10.0"' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "src/universal-format-mcp holds the TS sources and the build driver" {
  [ -f "$REPO_ROOT/src/universal-format-mcp/server.ts" ]
  [ -f "$REPO_ROOT/src/universal-format-mcp/build.mjs" ]
}

@test "root package.json declares the build:universal-format-mcp script" {
  run jq -e '.scripts["build:universal-format-mcp"] == "node src/universal-format-mcp/build.mjs"' "$REPO_ROOT/package.json"
  assert_success
}

# The bundled prettier makes the resolver, the managed copy and npx dead: the sources must not
# even mention them. (Explicit file list, never a recursive grep: rg_or_grep's flag rewriting
# turns grep's -r into rg's --replace.)
@test "src/universal-format-mcp mentions neither CLAUDE_PLUGIN_DATA nor npx" {
  run rg_or_grep -q -F "CLAUDE_PLUGIN_DATA" "$REPO_ROOT/src/universal-format-mcp"/*.ts "$REPO_ROOT/src/universal-format-mcp/build.mjs"
  assert_failure
  run rg_or_grep -q -F "npx" "$REPO_ROOT/src/universal-format-mcp"/*.ts "$REPO_ROOT/src/universal-format-mcp/build.mjs"
  assert_failure
}

@test "mcp/server.mjs is the generated bundle: @ts-nocheck banner on line 2, fingerprint on line 3" {
  run bash -c "sed -n 2p '$SERVER'"
  assert_output --partial "@ts-nocheck"
  run bash -c "sed -n 3p '$SERVER'"
  assert_output --regexp '^// uf-build-fingerprint src=[0-9a-f]{16} body=[0-9a-f]{16} prettier=[0-9.]+ bun='
}

# High-signal: a real bun-built bundle of these sources contains 0 occurrences of either string,
# so a hit means the deleted managed-copy/npx machinery came back.
@test "mcp/server.mjs mentions neither CLAUDE_PLUGIN_DATA nor npx" {
  run rg_or_grep -q -F "CLAUDE_PLUGIN_DATA" "$SERVER"
  assert_failure
  run rg_or_grep -q -F "npx" "$SERVER"
  assert_failure
}

@test "no user-facing description advertises a managed copy or npx" {
  run bash -c "jq -r '.description' '$PLUGIN/.claude-plugin/plugin.json' | grep -qivE 'managed|npx'"
  assert_success
  run bash -c "jq -r '.description' '$HOOKS' | grep -qivE 'managed|npx'"
  assert_success
}

@test "plugin CLAUDE.md documents the bundled prettier and the built artifact, not the deleted machinery" {
  run rg_or_grep -q -F "Managed prettier copy" "$PLUGIN/CLAUDE.md"
  assert_failure
  run rg_or_grep -q -F "3-tier resolver" "$PLUGIN/CLAUDE.md"
  assert_failure
  run rg_or_grep -q -F "Bundled prettier (no resolver)" "$PLUGIN/CLAUDE.md"
  assert_success
  run rg_or_grep -q -F "Built artifact (do not edit" "$PLUGIN/CLAUDE.md"
  assert_success
}

@test "root CLAUDE.md documents src/ and the build script" {
  run rg_or_grep -q -F "src/universal-format-mcp" "$REPO_ROOT/CLAUDE.md"
  assert_success
  run rg_or_grep -q -F "pnpm run build:universal-format-mcp" "$REPO_ROOT/CLAUDE.md"
  assert_success
}
