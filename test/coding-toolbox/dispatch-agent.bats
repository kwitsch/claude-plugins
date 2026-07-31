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
  assert_output --partial '"Bash(git:*)"'
  assert_output --partial '"Bash(claude:*)"'
  assert_output --partial '"AskUserQuestion"'
  refute_output --partial '"Agent"'
  refute_output --partial '"Skill"'
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
@test "dispatch-agent dispatches via claude --bg with a hand-created worktree" {
  run cat "$PLUGIN/skills/dispatch-agent/SKILL.md"
  assert_success
  assert_output --partial "claude --bg"
  assert_output --partial "git worktree add -b"
}
