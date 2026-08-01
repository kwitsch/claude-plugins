#!/usr/bin/env bats

# Scaffold invariants for the universal-lint plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "plugin.json is valid JSON with name/version and no userConfig (deliberate — see CLAUDE.md)" {
  run jq -e '.name == "universal-lint" and (.version | type == "string") and (has("userConfig") | not)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin is registered in marketplace.json without a version field" {
  run jq -e '[.plugins[] | select(.name == "universal-lint" and .source == "./plugins/universal-lint")] | length == 1' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
  run jq -e '[.plugins[] | select(.name == "universal-lint") | has("version")] | any | not' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "plugin has a root README table row" {
  run rg_or_grep -F "[universal-lint](plugins/universal-lint/README.md)" "$REPO_ROOT/README.md"
  assert_success
}

@test "plugin is in the test.yml matrix" {
  run rg_or_grep -E "^\s*-\s*universal-lint\s*$" "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS"
  assert_success
}

@test "PostToolUse hook is wired to lint-file.mjs as an async command hook with timeout 90" {
  run jq -e '.hooks.PostToolUse[0] | .matcher == "Write|Edit" and (.hooks[0].type == "command") and (.hooks[0].command | endswith("hooks/lint-file.mjs")) and (.hooks[0].timeout == 90) and (.hooks[0].async == true)' "$HOOKS"
  assert_success
}

@test "lint-file.mjs is executable (repo rule)" {
  [ -x "$SERVER" ]
}

@test "lint-file.mjs has a node shebang" {
  run head -n1 "$SERVER"
  assert_output '#!/usr/bin/env node'
}

@test "bundled markdownlint-no-line-length.json exists and disables only MD013" {
  local cfg="$PLUGIN/hooks/markdownlint-no-line-length.json"
  [ -f "$cfg" ]
  run jq -e '. == {"MD013": false}' "$cfg"
  assert_success
}

@test "lint-file.mjs passes node --check" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run node --check "$SERVER"
  assert_success
}

@test "lint-file.mjs runs as a direct command hook: unsupported extension -> no stdout" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/smoke"; mkdir -p "$cwd"
  printf 'hi\n' > "$cwd/z.txt"
  run bash -c '
    jq -cn --arg f "z.txt" --arg c "'"$cwd"'" '"'"'{hook_event_name:"PostToolUse", tool_name:"Write", tool_input:{file_path:$f}, tool_response:{success:true}, cwd:$c}'"'"' \
      | node "'"$SERVER"'"
  '
  assert_success
  [ -z "$output" ]
}

@test "plugin README first ## heading is Install" {
  run bash -c "rg_or_grep -m1 '^## ' '$PLUGIN/README.md'"
  assert_success
  assert_output "## Install"
}

@test "plugin README contains the install command" {
  run rg_or_grep -F "/plugin install universal-lint@kwitsch-plugins" "$PLUGIN/README.md"
  assert_success
}

@test "plugin README has no ## Hooks section" {
  run rg_or_grep -E "^## Hooks" "$PLUGIN/README.md"
  assert_failure
}

