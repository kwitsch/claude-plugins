#!/usr/bin/env bats
load 'test_helper'

setup() {
  common_setup
}

@test "finish-pr SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr frontmatter declares name/description/allowed-tools and stays scoped" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/finish-pr/SKILL.md'"
  assert_success
  assert_output --partial "name: finish-pr"
  assert_output --partial "AskUserQuestion"
  assert_output --partial 'Bash(gh:*)'
  assert_output --partial 'Bash(glab:*)'
  # tripwire: this skill dispatches nothing and takes no arguments
  refute_output --partial "Agent"
  refute_output --partial "Workflow"
  refute_output --partial "TaskCreate"
  refute_output --partial "argument-hint"
  refute_output --partial "Bash(bash:*)"
}

@test "finish-pr aborts when no PR/MR exists for the branch" {
  run rg_or_grep -F "No PR/MR found for branch" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr handles merged and closed PR/MR states before any mutation" {
  run rg_or_grep -F "already merged" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "closed (not merged)" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr undrafts via gh pr ready and glab mr update --ready" {
  run rg_or_grep -F "gh pr ready" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F -- "--ready" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr enables GitLab delete-source-branch-on-merge only when off, with toggle-safety wording" {
  run rg_or_grep -F -- "--remove-source-branch" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "toggles the setting" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "should_remove_source_branch" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "force_remove_source_branch" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr skips the delete-source-branch step entirely on GitHub" {
  run rg_or_grep -F "Skip this step entirely on GitHub" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr keeps origin/base current via git fetch in its git-context block" {
  run rg_or_grep -F "git fetch origin" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr never uses gh pr edit, uses gh api PATCH instead" {
  run rg_or_grep -F "never \`gh pr edit\`" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "gh api -X PATCH" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr never passes --yes to glab mr update" {
  run rg_or_grep -F -- "glab mr update" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run cat "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  refute_output --partial -- "--yes"
}

@test "plugin README lists finish-pr in the Skills section" {
  run rg_or_grep -F '| `finish-pr`' "$PLUGIN/README.md"
  assert_success
}

@test "plugin.json description mentions finish-pr" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output --partial "finish-pr"
}
