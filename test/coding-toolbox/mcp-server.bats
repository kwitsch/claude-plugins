#!/usr/bin/env bats

# Shared coding-toolbox-hooks MCP server plumbing (hooks.json, .mcp.json, bin/mjs-launch.sh, mcp/server.mjs) — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS/hooks.json"
  assert_success
}
@test ".mcp.json registers coding-toolbox-hooks -> bin/mjs-launch.sh mcp/server.mjs" {
  run jq -e '.mcpServers["coding-toolbox-hooks"].command | endswith("bin/mjs-launch.sh")' "$PLUGIN/.mcp.json"
  assert_success
  run jq -e '.mcpServers["coding-toolbox-hooks"].args == ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]' "$PLUGIN/.mcp.json"
  assert_success
}
@test "mcp/server.mjs is executable (repo rule)" {
  [ -x "$PLUGIN/mcp/server.mjs" ]
}

# --- bin/mjs-launch.sh (runtime launcher: bun-preferred, node fallback) -----

@test "bin/mjs-launch.sh is executable (repo rule)" {
  [ -x "$SCRIPTS/mjs-launch.sh" ]
}
@test "bin/mjs-launch.sh has a bash shebang and passes bash -n" {
  run head -n1 "$SCRIPTS/mjs-launch.sh"
  assert_output '#!/usr/bin/env bash'
  run bash -n "$SCRIPTS/mjs-launch.sh"
  assert_success
}
@test "bin/mjs-launch.sh errors on missing argument (exit 64)" {
  run "$SCRIPTS/mjs-launch.sh"
  assert_failure 64
  assert_output --partial "missing argument"
}

# The `env -i ... HOME="$HOME" ...` idiom below (through the ~/.local/bin test) is safe:
# setup() already redirects HOME to "$BATS_TEST_TMPDIR/home", so it's never the host home
# and the ~/.local/bin writes stay isolated -- CodeRabbit PRRT_kwDOSsj0xM6RhOov false positive.
@test "bin/mjs-launch.sh errors when neither bun nor node is on PATH" {
  local fakebin="$BATS_TEST_TMPDIR/fakebin-none"
  mkdir -p "$fakebin"
  for t in bash env; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  run env -i PATH="$fakebin" HOME="$HOME" "$SCRIPTS/mjs-launch.sh" /some/script.mjs
  assert_failure 1
  assert_output --partial "neither bun nor node is available"
}
@test "bin/mjs-launch.sh falls back to node when bun is absent" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-node"
  mkdir -p "$fakebin"
  for t in bash env node; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  run env -i PATH="$fakebin" HOME="$HOME" "$SCRIPTS/mjs-launch.sh" --version
  assert_success
}
@test "bin/mjs-launch.sh prefers bun over node when both are on PATH" {
  command -v bun >/dev/null 2>&1 || skip "bun not installed"
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-both"
  mkdir -p "$fakebin"
  for t in bash env node bun; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  local probe="$BATS_TEST_TMPDIR/which-runtime.mjs"
  printf 'console.log(typeof Bun !== "undefined" ? "bun" : "node")\n' > "$probe"
  run env -i PATH="$fakebin" HOME="$HOME" "$SCRIPTS/mjs-launch.sh" "$probe"
  assert_success
  assert_output "bun"
}
@test "bin/mjs-launch.sh appends ~/.local/bin after the inherited PATH, so a system-PATH tool wins over a same-named one there" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-syspath"
  mkdir -p "$fakebin" "$HOME/.local/bin"
  for t in bash env node; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  printf '#!/usr/bin/env bash\necho system-path-tool\n' > "$fakebin/dupe-tool"
  chmod +x "$fakebin/dupe-tool"
  printf '#!/usr/bin/env bash\necho stale-local-bin-tool\n' > "$HOME/.local/bin/dupe-tool"
  chmod +x "$HOME/.local/bin/dupe-tool"
  local probe="$BATS_TEST_TMPDIR/which-tool.mjs"
  printf 'import { execSync } from "node:child_process";\nconsole.log(execSync("command -v dupe-tool").toString().trim());\n' > "$probe"
  run env -i PATH="$fakebin" HOME="$HOME" "$SCRIPTS/mjs-launch.sh" "$probe"
  assert_success
  assert_output "$fakebin/dupe-tool"
}
@test "bin/mjs-launch.sh launches server.mjs correctly (interaction_gate listed over stdio)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run bash -c '
    printf "%s\n%s\n" \
      "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" \
      "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" \
      | "'"$SCRIPTS/mjs-launch.sh"'" "'"$PLUGIN/mcp/server.mjs"'"
  '
  assert_success
  assert_output --partial '"interaction_gate"'
}
@test "tools/list includes interaction_gate and worktree_refresh" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  run bash -c '
    printf "%s\n%s\n" \
      "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" \
      "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" \
    | node "'"$PLUGIN"'/mcp/server.mjs"
  '
  assert_success
  assert_output --partial '"interaction_gate"'
  assert_output --partial '"worktree_refresh"'
}
