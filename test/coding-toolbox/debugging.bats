#!/usr/bin/env bats

# debugging skill — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "plugin README lists debugging in the Skills section" {
  run rg_or_grep -F '| `debugging`' "$PLUGIN/README.md"
  assert_success
}
@test "debugging SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/debugging/SKILL.md"
  assert_success
}
@test "debugging frontmatter declares name and required allowed-tools" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/debugging/SKILL.md'"
  assert_success
  assert_output --partial "name: debugging"
  assert_output --partial "work_description"
  assert_output --partial '"Read"'
  assert_output --partial '"Edit"'
  assert_output --partial '"Write"'
  assert_output --partial '"Grep"'
  assert_output --partial '"Glob"'
  assert_output --partial '"Bash"'
  assert_output --partial '"ToolSearch"'
  refute_output --partial '"Skill"'
  refute_output --partial '"Agent"'
  refute_output --partial '"Workflow"'
  refute_output --partial "TaskCreate"
  refute_output --partial "AskUserQuestion"
}
@test "debugging skill dir is self-contained (no cross-plugin references)" {
  run bash -c "
    if command -v rg >/dev/null 2>&1; then
      rg -i --no-ignore --hidden -a 'superpowers|branch-management' '$PLUGIN/skills/debugging/'
    else
      grep -riE 'superpowers|branch-management' '$PLUGIN/skills/debugging/'
    fi
  "
  assert_failure 1
}
@test "debugging references/debugging.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/debugging/references/debugging.md"
  assert_success
}
@test "debugging reference demands root cause and a failing test before any fix" {
  run cat "$PLUGIN/skills/debugging/references/debugging.md"
  assert_success
  assert_output --partial "root cause"
  assert_output --partial "failing test"
  assert_output --partial "AskUserQuestion"
  assert_output --partial "return to the caller"
  refute_output --partial "return to the orchestrator's PR step"
}
