#!/usr/bin/env bats

# fresh-work skill — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "plugin.json description mentions fresh-work and its sibling skills" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output --partial "fresh-work"
  assert_output --partial "feature-development"
  assert_output --partial "debugging"
}
@test "fresh-work skill dir is self-contained (no cross-plugin references)" {
  run bash -c "
    if command -v rg >/dev/null 2>&1; then
      rg -i --no-ignore --hidden -a 'superpowers|branch-management' '$PLUGIN/skills/fresh-work/'
    else
      grep -riE 'superpowers|branch-management' '$PLUGIN/skills/fresh-work/'
    fi
  "
  assert_failure 1
}
@test "fresh-work SKILL.md exists with required frontmatter" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/fresh-work/SKILL.md'"
  assert_success
  assert_output --partial "name: fresh-work"
  assert_output --partial "argument-hint"
  assert_output --partial "work_description"
  assert_output --partial '"Skill"'
  assert_output --partial '"Read"'
  assert_output --partial "ToolSearch"
  assert_output --partial "TaskCreate"
  refute_output --partial '"Agent"'
  refute_output --partial '"Workflow"'
  # AskUserQuestion is deliberately no longer pre-approved here (still used in
  # the skill body — allowed-tools only pre-approves, doesn't restrict).
  refute_output --partial "AskUserQuestion"
}
@test "fresh-work classify table names both sibling skills, refactor and feature both routed to feature-development" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "coding-toolbox:debugging"
  assert_output --partial "coding-toolbox:feature-development"
  refute_output --partial "coding-toolbox:refactoring"
}
@test "fresh-work step 3 and step 5 still invoke fresh-branch and fresh-pr by name" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "coding-toolbox:fresh-branch"
  assert_output --partial "coding-toolbox:fresh-pr"
}
@test "fresh-work steps run classify, branch name, branch, dispatch, PR in order" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  # Position check, not just presence: each pattern is grepped separately and
  # anchored to the line start so line numbers reflect each step's own match —
  # `grep -n` on a single combined pattern always emits matches in ascending
  # line-number order regardless of alternation order, so it can never detect
  # a reordering (a false pass), and an unanchored "N. **X.**" would also match
  # inside a two-digit renumbering. Same rationale applies to the
  # feature-development ordering test further below.
  local skill_md="$output"
  local classify_line branch_name_line branch_line dispatch_line pr_line
  classify_line=$(rg_or_grep -n '^1\. \*\*Classify\.\*\*' <<< "$skill_md" | cut -d: -f1)
  branch_name_line=$(rg_or_grep -n '^2\. \*\*Branch name\.\*\*' <<< "$skill_md" | cut -d: -f1)
  branch_line=$(rg_or_grep -n '^3\. \*\*Branch\.\*\*' <<< "$skill_md" | cut -d: -f1)
  dispatch_line=$(rg_or_grep -n '^4\. \*\*Dispatch\.\*\*' <<< "$skill_md" | cut -d: -f1)
  pr_line=$(rg_or_grep -n '^5\. \*\*PR\.\*\*' <<< "$skill_md" | cut -d: -f1)
  [ -n "$classify_line" ] && [ -n "$branch_name_line" ] && [ -n "$branch_line" ] && [ -n "$dispatch_line" ] && [ -n "$pr_line" ]
  [ "$classify_line" -lt "$branch_name_line" ]
  [ "$branch_name_line" -lt "$branch_line" ]
  [ "$branch_line" -lt "$dispatch_line" ]
  [ "$dispatch_line" -lt "$pr_line" ]
}
@test "fresh-work attributes the minor-findings list to Implement, not Review" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "minor-findings list (produced"
  assert_output --partial "own Implement step, passed through unchanged by Review"
  refute_output --partial "from its own Review step"
}
@test "fresh-work step 2 states the derived branch name to the user before branching" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "State the derived name to the user (plain"
  assert_output --partial "output, not a question) before step 3."
}
@test "plugin README lists fresh-work in the Skills section" {
  run rg_or_grep -F '| `fresh-work`' "$PLUGIN/README.md"
  assert_success
}
@test "fresh-work branch naming demands a concise English summary, never a verbatim slug" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "3–6 **English** words"
  assert_output --partial "never slugify it verbatim"
}
