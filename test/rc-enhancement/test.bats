#!/usr/bin/env bats

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/rc-enhancement"
  HOOKS="$PLUGIN/hooks/hooks.json"
}

@test "plugin.json is valid, pins version 0.1.0, and has required fields" {
  run jq -e '.name == "rc-enhancement" and .version == "0.1.0" and (.description | length > 0) and (.author.name == "Kwitsch")' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin.json carries no userConfig (single fixed contract)" {
  run jq -e 'has("userConfig") | not' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "hooks.json is valid JSON with exactly one SessionStart entry and one hook" {
  run jq -e '(.hooks.SessionStart | length) == 1 and (.hooks.SessionStart[0].hooks | length) == 1' "$HOOKS"
  assert_success
}

@test "hooks.json SessionStart hook is the exact cat command object" {
  run jq -e '.hooks.SessionStart[0].hooks[0] == {type:"command", command:"cat", args:["${CLAUDE_PLUGIN_ROOT}/hooks/SessionStart.md"], timeout:5}' "$HOOKS"
  assert_success
}

@test "hooks.json SessionStart group has no matcher and hook has no async" {
  run jq -e '.hooks.SessionStart[0] | has("matcher") | not' "$HOOKS"
  assert_success
  run jq -e '.hooks.SessionStart[0].hooks[0] | has("async") | not' "$HOOKS"
  assert_success
}

@test "SessionStart.md exists, is non-empty, and is committed as mode 100644" {
  [ -s "$PLUGIN/hooks/SessionStart.md" ]
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/rc-enhancement/hooks/SessionStart.md
  assert_success
  assert_line --regexp '^100644 [0-9a-f]+ 0[[:space:]]+plugins/rc-enhancement/hooks/SessionStart\.md$'
}

@test "hooks.json is committed as mode 100644" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/rc-enhancement/hooks/hooks.json
  assert_success
  assert_line --regexp '^100644 [0-9a-f]+ 0[[:space:]]+plugins/rc-enhancement/hooks/hooks\.json$'
}

@test "SessionStart.md contains all required rule tokens" {
  run grep -F 'CRITICAL RULE' "$PLUGIN/hooks/SessionStart.md"
  assert_success
  run grep -F 'AskUserQuestion' "$PLUGIN/hooks/SessionStart.md"
  assert_success
  run grep -F 'question mark' "$PLUGIN/hooks/SessionStart.md"
  assert_success
  run grep -F 'Other' "$PLUGIN/hooks/SessionStart.md"
  assert_success
  run grep -F 'Abort/Cancel' "$PLUGIN/hooks/SessionStart.md"
  assert_success
}

@test "cat reproduces SessionStart.md byte-for-byte through an isolated PATH" {
  run env -i PATH="/usr/bin:/bin" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" cat "$PLUGIN/hooks/SessionStart.md"
  assert_success
  [ "$output" = "$(cat "$PLUGIN/hooks/SessionStart.md")" ]
}

@test "marketplace.json has exactly one rc-enhancement entry with the right source and no version" {
  run jq -e '[.plugins[] | select(.name == "rc-enhancement" and .source == "./plugins/rc-enhancement")] | length == 1' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
  run jq -e '[.plugins[] | select(.name == "rc-enhancement") | has("version")] | any | not' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "marketplace.json rc-enhancement description is byte-identical to plugin.json" {
  plugin_desc="$(jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json")"
  market_desc="$(jq -r '.plugins[] | select(.name == "rc-enhancement") | .description' "$REPO_ROOT/.claude-plugin/marketplace.json")"
  [ "$plugin_desc" = "$market_desc" ]
}
