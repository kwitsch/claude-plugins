#!/usr/bin/env bats

# feature-development skill (design/plan/implement/review pipeline) — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "plugin README lists feature-development in the Skills section" {
  run rg_or_grep -F '| `feature-development`' "$PLUGIN/README.md"
  assert_success
}
@test "refactoring skill was removed (collapsed into feature-development)" {
  [ ! -e "$PLUGIN/skills/refactoring" ]
  run rg_or_grep -F '| `refactoring`' "$PLUGIN/README.md"
  assert_failure
}
@test "feature-development SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/feature-development/SKILL.md"
  assert_success
}
@test "feature-development frontmatter declares name and required allowed-tools" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/feature-development/SKILL.md'"
  assert_success
  assert_output --partial "name: feature-development"
  assert_output --partial "work_description"
  assert_output --partial '"Agent"'
  assert_output --partial '"Workflow"'
  assert_output --partial "TaskCreate"
  refute_output --partial '"Skill"'
  refute_output --partial "AskUserQuestion"
}
@test "feature-development skill dir is self-contained (no cross-plugin references)" {
  run bash -c "
    if command -v rg >/dev/null 2>&1; then
      rg -i --no-ignore --hidden -a 'superpowers|branch-management' '$PLUGIN/skills/feature-development/'
    else
      grep -riE 'superpowers|branch-management' '$PLUGIN/skills/feature-development/'
    fi
  "
  assert_failure 1
}
@test "feature-development keeps design docs out of the repository" {
  run cat "$PLUGIN/skills/feature-development/SKILL.md"
  assert_success
  assert_output --partial "mktemp"
  assert_output --partial "Never commit them"
}
@test "feature-development documents a complexity heuristic instead of a fixed advisor step" {
  run cat "$PLUGIN/skills/feature-development/SKILL.md"
  assert_success
  assert_output --partial "## Complexity heuristic"
  assert_output --partial "Workflow tool"
}
@test "feature-development runs the advisor on demand, not as a scheduled pipeline step" {
  run cat "$PLUGIN/skills/feature-development/SKILL.md"
  assert_success
  assert_output --partial "## Inline advisor protocol"
  assert_output --partial "not a scheduled pipeline step"
}
@test "feature-development Step-start reporting note clarifies it never substitutes for a step's own output" {
  run cat "$PLUGIN/skills/feature-development/SKILL.md"
  assert_success
  assert_output --partial "Starting step 1: Design."
  assert_output --partial "announcement never"
  assert_output --partial "substitutes for a step's own"
}
@test "feature-development documents step nesting under a caller's active step" {
  run cat "$PLUGIN/skills/feature-development/SKILL.md"
  assert_success
  assert_output --partial "Step 4.1"
  assert_output --partial "Step 4.5"
  assert_output --partial "stays \`in_progress\` throughout"
}
@test "feature-development and dispatch-shared.md define the caller-task lifecycle during nested dispatch" {
  run cat "$PLUGIN/skills/feature-development/SKILL.md"
  assert_success
  assert_output --partial "Never mark the caller's"
  run cat "$PLUGIN/skills/feature-development/references/dispatch-shared.md"
  assert_success
  assert_output --partial "scoped to this skill's own step list"
  assert_output --partial "legitimately"
  assert_output --partial "stays \`in_progress\` for the entire nested call"
}
@test "dispatch-shared.md reference file exists with the AskUserQuestion banner and Task-list core" {
  local shared="$PLUGIN/skills/feature-development/references/dispatch-shared.md"
  run test -s "$shared"
  assert_success
  run rg_or_grep -F "User decisions go through" "$shared"
  assert_success
  run rg_or_grep -F "never a question" "$shared"
  assert_success
}
@test "fresh-work and feature-development both read the shared dispatch-shared.md, never inline it" {
  run rg_or_grep -F 'references/dispatch-shared.md' "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  run rg_or_grep -F 'references/dispatch-shared.md' "$PLUGIN/skills/feature-development/SKILL.md"
  assert_success
}
@test "feature-development runs Design, Intent confirmation, Plan, Implement, Review in order" {
  run cat "$PLUGIN/skills/feature-development/SKILL.md"
  assert_success
  assert_output --partial "**Intent confirmation.**"
  assert_output --partial "Keypoints"
  assert_output --partial "**Review.**"
  assert_output --partial "references/reviewing.md"
  # Position check, not just presence — see the fresh-work ordering test
  # above for why each pattern is grepped separately and anchored.
  local skill_md="$output"
  local design_line intent_line plan_line implement_line review_line
  design_line=$(rg_or_grep -n '^1\. \*\*Design\.\*\*' <<< "$skill_md" | cut -d: -f1)
  intent_line=$(rg_or_grep -n '^2\. \*\*Intent confirmation\.\*\*' <<< "$skill_md" | cut -d: -f1)
  plan_line=$(rg_or_grep -n '^3\. \*\*Plan\.\*\*' <<< "$skill_md" | cut -d: -f1)
  implement_line=$(rg_or_grep -n '^4\. \*\*Implement\.\*\*' <<< "$skill_md" | cut -d: -f1)
  review_line=$(rg_or_grep -n '^5\. \*\*Review\.\*\*' <<< "$skill_md" | cut -d: -f1)
  [ -n "$design_line" ] && [ -n "$intent_line" ] && [ -n "$plan_line" ] && [ -n "$implement_line" ] && [ -n "$review_line" ]
  [ "$design_line" -lt "$intent_line" ]
  [ "$intent_line" -lt "$plan_line" ]
  [ "$plan_line" -lt "$implement_line" ]
  [ "$implement_line" -lt "$review_line" ]
}

# Regression guard: a prior run asked the Intent-confirmation AskUserQuestion
# without ever showing the design summary first. Pins the hardened wording
# that forces the Keypoints re-read + plain-text output as its own step,
# distinct from the generic step-start announcement, before the tool call.
@test "feature-development Intent confirmation forces the Keypoints output as its own message before AskUserQuestion" {
  run cat "$PLUGIN/skills/feature-development/SKILL.md"
  assert_success
  assert_output --partial 'Before calling `AskUserQuestion` for this step:'
  assert_output --partial "Read the design doc's Keypoints section fresh from the spec temp path."
  assert_output --partial "does not satisfy this"
  assert_output --partial 'Only then call `AskUserQuestion`'
}
@test "feature-development references/designing.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/feature-development/references/designing.md"
  assert_success
}
@test "feature-development designing reference gates user questions and keeps output out of the repo" {
  run cat "$PLUGIN/skills/feature-development/references/designing.md"
  assert_success
  assert_output --partial "genuinely changes the design"
  assert_output --partial "AskUserQuestion"
  assert_output --partial "spec temp path"
  assert_output --partial "Keypoints"
}
@test "feature-development designing reference scales itself to the task instead of a fixed advisor step" {
  run cat "$PLUGIN/skills/feature-development/references/designing.md"
  assert_success
  assert_output --partial "Scale to the task (your call, not a fixed step)"
  assert_output --partial "complexity heuristic"
  assert_output --partial "Workflow tool"
  assert_output --partial "Advisor consultation is your call too"
  assert_output --partial "self-review (below) always validates"
}
@test "feature-development references/planning.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/feature-development/references/planning.md"
  assert_success
}
@test "feature-development planning reference keeps global constraints and drops the execution-choice handoff" {
  run cat "$PLUGIN/skills/feature-development/references/planning.md"
  assert_success
  assert_output --partial "Global Constraints"
  assert_output --partial "plan temp path"
  refute_output --partial "Which approach"
}
@test "feature-development planning reference scales itself to the task instead of a fixed advisor step" {
  run cat "$PLUGIN/skills/feature-development/references/planning.md"
  assert_success
  assert_output --partial "Scale to the task (your call, not a fixed step)"
  assert_output --partial "complexity heuristic"
  assert_output --partial "Workflow tool"
  assert_output --partial "Advisor consultation is your call too"
  assert_output --partial "self-review (below) always validates"
}
@test "feature-development planning reference marks Files/Interfaces as load-bearing for scheduling" {
  run cat "$PLUGIN/skills/feature-development/references/planning.md"
  assert_success
  assert_output --partial "load-bearing"
  assert_output --partial "conservatively serialized"
}
@test "feature-development designing reference dispatches exploration to the explore agent, never inline" {
  run cat "$PLUGIN/skills/feature-development/references/designing.md"
  assert_success
  assert_output --partial "subagent_type: explore"
  assert_output --partial "never Grep/Glob/Read the"
}
@test "feature-development planning reference routes fresh codebase lookups through the explore agent" {
  run cat "$PLUGIN/skills/feature-development/references/planning.md"
  assert_success
  assert_output --partial "subagent_type: explore"
  assert_output --partial "Grep/Glob/Read yourself inline"
}
@test "feature-development planning reference mandates a machine-readable tasks block" {
  run cat "$PLUGIN/skills/feature-development/references/planning.md"
  assert_success
  assert_output --partial "## Machine-readable tasks"
  assert_output --partial "single source"
  assert_output --partial "never re-parsed"
}
@test "feature-development implementing reference consumes the machine-readable tasks block" {
  run cat "$PLUGIN/skills/feature-development/references/implementing.md"
  assert_success
  assert_output --partial "## Machine-readable tasks"
  assert_output --partial "authored by the Plan phase"
  refute_output --partial "task list parsed as"
}
@test "feature-development references/implementing.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/feature-development/references/implementing.md"
  assert_success
}
@test "feature-development implementing reference probes Workflow, falls back to Agent, and gates dispatches" {
  run cat "$PLUGIN/skills/feature-development/references/implementing.md"
  assert_success
  assert_output --partial "select:Workflow"
  assert_output --partial "Agent engine"
  assert_output --partial "Subagent reconciliation gate"
  assert_output --partial "'critical'"
}
@test "feature-development implementing reference inlines Workflow script values instead of using args" {
  run cat "$PLUGIN/skills/feature-development/references/implementing.md"
  assert_success
  assert_output --partial 'pass no `args` at all'
  # The prose note quotes the observed error ('args.tasks') deliberately; refute
  # only the buggy CODE forms (template interpolation / loop), not that mention.
  refute_output --partial '${args.planPath}'
  refute_output --partial 'for (const t of args.tasks)'
  refute_output --partial '${args.constraints}'
}
@test "feature-development implementing reference computes wave-parallel scheduling from Files/Interfaces" {
  run cat "$PLUGIN/skills/feature-development/references/implementing.md"
  assert_success
  assert_output --partial "Parallelism analysis"
  assert_output --partial "wave[i]"
  assert_output --partial "conservative"
}
@test "feature-development implementing reference isolates wave-parallel implementers and merges back" {
  run cat "$PLUGIN/skills/feature-development/references/implementing.md"
  assert_success
  assert_output --partial "isolation: 'worktree'"
  assert_output --partial "git merge --no-ff"
  assert_output --partial "hard stop"
}
@test "feature-development implementing reference keeps wave size 1 identical to today's flow" {
  run cat "$PLUGIN/skills/feature-development/references/implementing.md"
  assert_success
  assert_output --partial "wave size 1"
  assert_output --partial "unchanged"
}
@test "feature-development implementing reference computes waves as real code, not a hand-derived literal" {
  run cat "$PLUGIN/skills/feature-development/references/implementing.md"
  assert_success
  assert_output --partial "function computeWaves(tasksIn)"
  assert_output --partial "const waves = computeWaves(tasks)"
}
@test "feature-development implementing reference runs Agent-engine merge-back via Bash, not a merger dispatch" {
  run cat "$PLUGIN/skills/feature-development/references/implementing.md"
  assert_success
  assert_output --partial "orchestrator's own Bash"
  assert_output --partial "rather than dispatching a separate merger"
}
@test "subagent-tracking feature-development row reflects wave-parallel dispatch, not pure sequential" {
  RULE="$BATS_TEST_DIRNAME/../../.claude/rules/subagent-tracking.md"
  run rg_or_grep 'coding-toolbox:feature-development' "$RULE"
  assert_success
  assert_output --partial "wave-parallel"
  assert_output --partial "orchestrator's own Bash"
}
@test "feature-development references/reviewing.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/feature-development/references/reviewing.md"
  assert_success
}
@test "feature-development reviewing reference runs the combined review workflow, effort scaled to complexity" {
  run cat "$PLUGIN/skills/feature-development/references/reviewing.md"
  assert_success
  assert_output --partial "feature-development-review"
  assert_output --partial "cleanup:"
  assert_output --partial "reversesDecision"
  assert_output --partial "const MODEL = 'sonnet'"
  assert_output --partial "model: MODEL"
  assert_output --partial '`high`'
  assert_output --partial '`max`'
  # the former two built-in skills are no longer invoked via the Skill tool
  refute_output --partial "Invoke \`simplify\`"
  refute_output --partial "Invoke \`code-review\`"
}
@test "feature-development Review step commits each sub-pass separately, never bundled" {
  run cat "$PLUGIN/skills/feature-development/references/reviewing.md"
  assert_success
  assert_output --partial "one"
  assert_output --partial "fix per commit, never bundled"
}

@test "feature-development captures the plugin root via bare substitution, never a load-time shell injection" {
  run rg_or_grep -F 'Plugin root: ${CLAUDE_PLUGIN_ROOT}' "$PLUGIN/skills/feature-development/SKILL.md"
  assert_success
  # anti-pattern: `!`-injecting $CLAUDE_PLUGIN_ROOT fails outright,
  # deterministically, inside a worktree-isolated session (every session a
  # dispatch-agent-style skill launches into `claude --worktree ... --bg`).
  run rg_or_grep -F 'Plugin root: !`' "$PLUGIN/skills/feature-development/SKILL.md"
  assert_failure
}
