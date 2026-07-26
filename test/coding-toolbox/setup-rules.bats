#!/usr/bin/env bats

# setup-rules skill — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "setup-rules SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules frontmatter declares name, disable-model-invocation, argument-hint, and required allowed-tools" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/setup-rules/SKILL.md'"
  assert_success
  assert_output --partial "name: setup-rules"
  assert_output --partial "disable-model-invocation: true"
  assert_output --partial "AskUserQuestion"
  assert_output --partial 'Bash(cp:*)'
  assert_output --partial 'argument-hint: "[install|update|remove]'
}
@test "setup-rules verbatim parser rejects ambiguous input without guessing" {
  run rg_or_grep -F 'ambiguous' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  run rg_or_grep -F 'usage-error branch' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules target parser rejects two distinct named targets, but still absorbs bare rule/rules after a tool word" {
  run rg_or_grep -F 'target is named' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  run rg_or_grep -F 'the `tool`-family word absorbs the bare "rule"' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules detects installed rules via the coding-toolbox-*.md glob" {
  run rg_or_grep -F 'coding-toolbox-*.md' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules detects all four tools via command -v" {
  run rg_or_grep -c -e 'command -v rtk' -e 'command -v bun' -e 'command -v rg' -e 'command -v codebase-memory-mcp' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  assert_output "4"
}
@test "setup-rules copies golden-rules.md byte-exact for the golden-rules rule" {
  run rg_or_grep -F 'cp "<plugin root resolved in Step 1>/skills/setup-rules/references/golden-rules.md"' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules asks one single-select question per rule with a currently-installed header, not a multiSelect toggle" {
  run cat "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  assert_output --partial 'multiSelect: false'
  assert_output --partial '[currently: <installed|not installed>]'
  refute_output --partial 'multiSelect: true'
}
@test "setup-rules documents the disableSkillShellExecution guard" {
  run rg_or_grep -F '[shell command execution disabled by policy]' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules never overwrites the tools rule with an empty table when nothing is detected" {
  run rg_or_grep -F 'but `detected` is **empty**' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  run rg_or_grep -F 'make **no change**' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules documents that it is the only way to get golden rules injected" {
  run rg_or_grep -F 'this skill is the only way to get them onto this machine' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules installs to the user-level rules directory, not project-level" {
  run rg_or_grep -F '$HOME/.claude/rules' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules apply commands target both managed files under the user-level directory" {
  run rg_or_grep -c -F -e '$HOME/.claude/rules/coding-toolbox-rules.md' -e '$HOME/.claude/rules/coding-toolbox-tools.md' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  [ "$output" -ge 4 ]
}
@test "plugin README lists setup-rules in the Skills section" {
  run rg_or_grep -F '| `setup-rules`' "$PLUGIN/README.md"
  assert_success
}
