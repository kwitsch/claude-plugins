#!/usr/bin/env bats

# Mods hooks module wiring (encoding guard, worktree refresh, interaction gate) — coding-toolbox plugin.
# The hooks' logic is unit-tested by test/coding-toolbox/*.test.mjs (pnpm run test:unit); their
# wiring by plugins/coding-toolbox/tests/*.test.ts (claude plugin test, local only).

load 'test_helper'

setup() {
  common_setup
}

@test "hooks.json is exactly the mods module list" {
  run jq -e '. == {"modules":["./register.ts"]}' "$HOOKS/hooks.json"
  assert_success
}
@test "mod source and wiring-test files exist" {
  [ -f "$HOOKS/register.ts" ]
  [ -f "$HOOKS/policy.mjs" ]
  [ -f "$PLUGIN/tests/coding-toolbox.test.ts" ]
}
@test "register.ts hooks the four guarded tools, EnterWorktree, turn.start and turn.complete" {
  run grep -F 'on("tool.call", { tool: ["Read", "Edit", "Write", "Bash"] }' "$HOOKS/register.ts"
  assert_success
  run grep -F 'on("tool.call", { tool: "EnterWorktree" }' "$HOOKS/register.ts"
  assert_success
  run grep -F 'on("turn.start"' "$HOOKS/register.ts"
  assert_success
  run grep -F 'on("turn.complete"' "$HOOKS/register.ts"
  assert_success
}
@test "the worktree_refresh toggle reaches the module through options, not an MCP server env" {
  run grep -F 'isWorktreeRefreshEnabled(options.worktree_refresh)' "$HOOKS/register.ts"
  assert_success
}
@test "policy.mjs stays pure: it never references the mods API \$" {
  run grep -nE '\$\.[a-z]+\.' "$HOOKS/policy.mjs"
  assert_failure
}
@test "the hook-only MCP server and its launcher are gone; bin/ci-watch.sh stays" {
  [ ! -e "$PLUGIN/.mcp.json" ]
  [ ! -e "$PLUGIN/mcp" ]
  [ ! -e "$SCRIPTS/mjs-launch.sh" ]
  [ ! -e "$HOOKS/encoding-guard.mjs" ]
  [ -x "$SCRIPTS/ci-watch.sh" ]
}
@test "plugin.json description mentions the encoding guard and the worktree_refresh hook" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output --partial "non-UTF-8"
  assert_output --partial "worktree_refresh"
}
@test "plugin.json declares exactly the worktree_refresh userConfig: boolean, default true, fail-open" {
  run jq -e '(.userConfig | keys) == ["worktree_refresh"]' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
  run jq -e '.userConfig.worktree_refresh
    | .type == "boolean"
      and .default == true
      and (.title | length > 0)
      and (.description | length > 0)' "$PLUGIN/.claude-plugin/plugin.json"
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
