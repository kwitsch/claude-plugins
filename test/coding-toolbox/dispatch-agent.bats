#!/usr/bin/env bats

# dispatch-agent skill — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "plugin README lists dispatch-agent in the Skills section" {
  run rg_or_grep -F '| `dispatch-agent`' "$PLUGIN/README.md"
  assert_success
}
@test "dispatch-agent SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/dispatch-agent/SKILL.md"
  assert_success
}
@test "dispatch-agent frontmatter declares name, arguments, and required allowed-tools" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/dispatch-agent/SKILL.md'"
  assert_success
  assert_output --partial "name: dispatch-agent"
  assert_output --partial "arguments: prompt"
  assert_output --partial '"Bash"'
  assert_output --partial '"AskUserQuestion"'
  refute_output --partial '"Agent"'
  refute_output --partial '"Skill"'
  refute_output --partial '"Bash(git:*)"'
  refute_output --partial "TaskCreate"
}
@test "dispatch-agent skill dir is self-contained (no cross-plugin references)" {
  run bash -c "
    if command -v rg >/dev/null 2>&1; then
      rg -i --no-ignore --hidden -a 'superpowers|branch-management' '$PLUGIN/skills/dispatch-agent/'
    else
      grep -riE 'superpowers|branch-management' '$PLUGIN/skills/dispatch-agent/'
    fi
  "
  assert_failure 1
}
@test "dispatch-agent dispatches via claude --worktree ... --bg" {
  run cat "$PLUGIN/skills/dispatch-agent/SKILL.md"
  assert_success
  assert_output --partial "claude --worktree"
  assert_output --partial "--bg"
}
@test "dispatch-agent supports --model/--effort overrides, defaults, and forces permission-mode auto" {
  run cat "$PLUGIN/skills/dispatch-agent/SKILL.md"
  assert_success
  assert_output --partial "--model=<model>"
  assert_output --partial "--effort=<effort>"
  assert_output --partial "sonnet"
  assert_output --partial "xhigh"
  assert_output --partial "--permission-mode auto"
}
@test "dispatch-agent validates model/effort as safe bare tokens before shell substitution" {
  run cat "$PLUGIN/skills/dispatch-agent/SKILL.md"
  assert_success
  assert_output --partial '^[A-Za-z0-9._-]+$'
  assert_output --partial "RANDOM"
}
@test "dispatch-agent has no pre-dispatch current-branch sync step" {
  run cat "$PLUGIN/skills/dispatch-agent/SKILL.md"
  assert_success
  refute_output --partial "git fetch origin"
  refute_output --partial "merge --ff-only"
}
@test "dispatch-agent and CLAUDE.md document worktree.baseRef instead of assuming the default branch unconditionally" {
  run rg_or_grep -F 'worktree.baseRef' "$PLUGIN/skills/dispatch-agent/SKILL.md"
  assert_success
  run rg_or_grep -F '"head"' "$PLUGIN/skills/dispatch-agent/SKILL.md"
  assert_success
  run rg_or_grep -F 'worktree.baseRef' "$PLUGIN/CLAUDE.md"
  assert_success
  run rg_or_grep -F '"head"' "$PLUGIN/CLAUDE.md"
  assert_success
}
