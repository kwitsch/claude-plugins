#!/usr/bin/env bats

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/memory-enhancement"
  HOOKS="$PLUGIN/hooks/hooks.json"
}

@test "plugin.json declares no hard dependency and auto_dream default true" {
  run jq -e '(.dependencies == null) and .userConfig.auto_dream.default == true and .userConfig.auto_dream.type == "boolean"' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin.json userConfig declares exactly auto_dream" {
  run jq -e '(.userConfig | keys) == ["auto_dream"]' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin.json is valid JSON with name and version 0.5.0" {
  run jq -e '.name == "memory-enhancement" and .version == "0.5.0"' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "hooks.json is exactly the mods module list" {
  run jq -e '. == {"modules":["./register.ts"]}' "$HOOKS"
  assert_success
}

@test "mod source and wiring-test files exist, old command hooks are gone" {
  [ -f "$PLUGIN/hooks/register.ts" ]
  [ -f "$PLUGIN/hooks/dream.mjs" ]
  [ -f "$PLUGIN/tests/memory-enhancement.test.ts" ]
  [ ! -e "$PLUGIN/hooks/flag-dream-due.mjs" ]
  [ ! -e "$PLUGIN/hooks/check-dream-due.mjs" ]
}

# core.fileMode = false in this repo, so `[ -x ]` passes even when git recorded 100644 — assert the index.
@test "hooks/dream.mjs is 100755 in the git index (hooks-executable rule)" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/memory-enhancement/hooks/dream.mjs
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/memory-enhancement/hooks/dream\.mjs$'
}

@test "session.start hook skips resumed sessions and the gate reads options.auto_dream" {
  run grep -F '(await $.session.turns()) > 0' "$PLUGIN/hooks/register.ts"
  assert_success
  run grep -F 'isAutoDreamEnabled(options.auto_dream)' "$PLUGIN/hooks/register.ts"
  assert_success
}

@test "claude plugin validate succeeds" {
  command -v claude >/dev/null || skip "claude CLI unavailable"
  run claude plugin validate "$PLUGIN"
  assert_success
}

@test "claude plugin test succeeds" {
  command -v claude >/dev/null || skip "claude CLI unavailable"
  run claude plugin test "$PLUGIN"
  assert_success
}
