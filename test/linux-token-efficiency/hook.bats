#!/usr/bin/env bats

# The mods hooks module (hooks/register.ts) — the Bash router (context-mode steer + rtk
# rewrite) and the WebFetch steer as in-process tool.call hooks, linux-token-efficiency.
#
# Behaviour lives in two other suites: the pure policy in rtk-rewrite.test.mjs
# (`pnpm run test:unit`, CI) and the hook wiring in
# plugins/linux-token-efficiency/tests/linux-token-efficiency.test.ts (`claude plugin
# test`, local only — CI runners have no claude CLI, so the last two cases skip there).

load 'test_helper'

setup() {
  REAL_HOME="$HOME" # common_setup sandboxes HOME; the claude CLI cases below need the real one
  common_setup
}

@test "hooks.json loads the mods module beside the classic hooks" {
  run jq -e '.modules == ["./register.ts"]' "$HOOKS"
  assert_success
  run jq -e '.hooks | type == "object"' "$HOOKS"
  assert_success
}

@test "no classic Bash or WebFetch entry is left: the module owns both" {
  run jq -e '[.hooks.PreToolUse[].matcher] | (index("Bash") == null) and (index("WebFetch") == null)' "$HOOKS"
  assert_success
  run grep -F 'rtk-rewrite.mjs"' "$HOOKS"
  assert_failure
  run grep -F 'webfetch-steer' "$HOOKS"
  assert_failure
}

@test "the module registers exactly the Bash and WebFetch tool.call hooks and reads userConfig from options" {
  run grep -c 'on("tool.call"' "$PLUGIN/hooks/register.ts"
  assert_output '2'
  run grep -F 'on("tool.call", { tool: "Bash" }' "$PLUGIN/hooks/register.ts"
  assert_success
  run grep -F 'on("tool.call", { tool: "WebFetch" }' "$PLUGIN/hooks/register.ts"
  assert_success
  run grep -F 'options.steer_enabled' "$PLUGIN/hooks/register.ts"
  assert_success
  run grep -F 'options.auto_rewrite' "$PLUGIN/hooks/register.ts"
  assert_success
  # The command-hook era read CLAUDE_PLUGIN_OPTION_* env vars; the module never does.
  run grep -F 'CLAUDE_PLUGIN_OPTION_' "$PLUGIN/hooks/register.ts" "$PLUGIN/hooks/rtk-rewrite.mjs"
  assert_failure
}

@test "the policy module stays importable by the engine: no node: import, no mods \$" {
  run grep -E '^import |from "node:' "$PLUGIN/hooks/rtk-rewrite.mjs"
  assert_failure
  run grep -F '$.' "$PLUGIN/hooks/rtk-rewrite.mjs"
  assert_failure
}

@test "the webfetch-steer entry point is gone and no code, config or test references it" {
  [ ! -e "$PLUGIN/hooks/webfetch-steer.mjs" ]
  run grep -rF --exclude='*.md' --exclude=hook.bats 'webfetch-steer' "$PLUGIN" "$REPO_ROOT/test/linux-token-efficiency"
  assert_failure
}

@test "hooks.json contains no user_config placeholder" {
  run grep -F 'user_config' "$HOOKS"
  assert_failure
}

@test "rtk-rewrite.mjs is executable in the git index (100755)" {
  # hooks-executable rule: every hooks/*.mjs keeps 100755, though the engine imports it.
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/hooks/rtk-rewrite.mjs
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/hooks/rtk-rewrite\.mjs$'
}

@test "mod source and wiring-test files exist" {
  [ -f "$PLUGIN/hooks/register.ts" ]
  [ -f "$PLUGIN/hooks/rtk-rewrite.mjs" ]
  [ -f "$PLUGIN/tests/linux-token-efficiency.test.ts" ]
}

@test "claude plugin validate succeeds" {
  command -v claude > /dev/null || skip "claude CLI unavailable"
  run env HOME="$REAL_HOME" claude plugin validate "$PLUGIN"
  assert_success
}

@test "claude plugin test succeeds" {
  command -v claude > /dev/null || skip "claude CLI unavailable"
  run env HOME="$REAL_HOME" claude plugin test "$PLUGIN"
  assert_success
}
