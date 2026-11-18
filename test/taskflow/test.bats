#!/usr/bin/env bats
# Structural suite for the taskflow plugin. Hermetic: no network, no execution
# of the Workflow-tool scripts (they run only inside the Workflow tool's own
# runtime) — everything here is manifest/frontmatter/shape assertions.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/taskflow"
  SKILL="$PLUGIN/skills/build-task"
  DISPATCH="$PLUGIN/skills/dispatch-task"
  CHANGES_AUDIT="$PLUGIN/skills/changes-audit"
  BT_WF="$SKILL/workflows"
  BT_ROLES="$PLUGIN/agents"
  AGENTS_DIR="$PLUGIN/agents"
  WORKFLOWS="$PLUGIN/workflows"
  MARKET="$REPO_ROOT/.claude-plugin/marketplace.json"
  ESLINT_CONFIG="$REPO_ROOT/eslint.config.mjs"
  MERGE_SCRIPT="$PLUGIN/bin/ship-ensure-mergeable.sh"
}

rg_or_grep() {
  if command -v rg >/dev/null 2>&1; then
    local args=() a stripped seen_dashdash=false
    for a in "$@"; do
      if [ "$seen_dashdash" = true ]; then
        args+=("$a")
        continue
      fi
      case "$a" in
        --) seen_dashdash=true; args+=("$a") ;;
        -[A-Za-z]*)
          stripped="${a//E/}"
          [ "$stripped" = "-" ] && continue
          args+=("$stripped")
          ;;
        *) args+=("$a") ;;
      esac
    done
    command rg "${args[@]}"
  else
    command grep "$@"
  fi
}
export -f rg_or_grep

# The workflows are dprint-formatted, which puts a multi-line arrow body or a
# `+` continuation on the line after its head: assert "<head> is directly
# followed by a line containing <next>" instead of pinning one joined line.
followed_by() { # <head> <next> <file>
  grep -A1 -F -- "$1" "$3" | grep -qF -- "$2"
}

# --- Manifest invariants ---

@test "plugin.json is valid and has required fields, no userConfig (deliberate — see CLAUDE.md)" {
  run jq -e '.name == "taskflow" and (.version | type == "string") and (.description | length > 0) and (has("userConfig") | not)' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
}

@test "plugin.json version is 2.1.0" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" = "2.1.0" ]
}

@test "marketplace taskflow description matches plugin.json and names the design pipeline" {
  run jq -r '.plugins[] | select(.name == "taskflow") | .description' "$MARKET"
  [ "$status" -eq 0 ]
  [ "$output" = "$(jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json")" ]
  [[ "$output" == *"runs the design pipeline (explore, design, spec)"* ]]
  [[ "$output" == *"and the delivery pipeline (plan, wave-parallel implement, combined review, ship)"* ]]
}

@test "no design-to-spec mention survives in the plugin, root README, marketplace or repo memory files" {
  run grep -rnF 'design-to-spec' "$PLUGIN" "$REPO_ROOT/README.md" "$REPO_ROOT/.claude-plugin" "$REPO_ROOT/.claude/rules" "$REPO_ROOT/plugins/CLAUDE.md" "$REPO_ROOT/CLAUDE.md"
  [ "$status" -eq 1 ]
}

@test "marketplace entry exists for taskflow" {
  run jq -e '.plugins[] | select(.name == "taskflow")' "$MARKET"
  [ "$status" -eq 0 ]
}

@test "marketplace entry carries no version (version lives only in plugin.json)" {
  run jq -e '.plugins[] | select(.name == "taskflow") | has("version")' "$MARKET"
  [ "$output" = "false" ]
}

# --- build-task skill ---

@test "build-task SKILL.md exists" {
  [ -f "$SKILL/SKILL.md" ]
}

@test "build-task SKILL.md has name and description frontmatter" {
  run rg_or_grep -E '^name:[[:space:]]*build-task' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^description:' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "build-task SKILL.md allowed-tools includes Workflow and AskUserQuestion" {
  run rg_or_grep -E '^allowed-tools:.*Workflow' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^allowed-tools:.*AskUserQuestion' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "build-task SKILL.md is model-invocable (no disable-model-invocation)" {
  run rg_or_grep -E '^disable-model-invocation:[[:space:]]*true' "$SKILL/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "build-task SKILL.md references all seven usage reference files" {
  for f in workflows/explore.md workflows/design.md workflows/spec.md workflows/plan.md workflows/implement.md workflows/review.md workflows/ship.md; do
    run rg_or_grep -F "$f" "$SKILL/SKILL.md"
    [ "$status" -eq 0 ]
  done
}

@test "all seven usage reference files exist and are non-empty; the references/ directory is gone" {
  for f in workflows/explore.md workflows/design.md workflows/spec.md workflows/plan.md workflows/implement.md workflows/review.md workflows/ship.md; do
    [ -s "$SKILL/$f" ]
  done
  [ ! -e "$SKILL/references" ]
}

@test "build-task SKILL.md runs all seven scripts by scriptPath and sizes the task (jev-api or own reasoning)" {
  for p in 'Never use `scriptPath`' 'taskflow:build-task-<name>' 'build-task-explore' 'build-task-design' 'build-task-spec' 'args global is undefined' 'select:mcp__jev-api__score' 'S: a few lines in one place' 'M: one component' 'L: several functionalities, modules or subprojects' 'XL: cross-cutting or architectural' 'confidence >= 0.6' 'explore-<slug>.md' 'The skill never Reads these files' 'EXPLORE_PATH' 'SIZE' 'build-task-plan' 'build-task-implement' 'build-task-review' 'build-task-ship' 'IMPLEMENT_PATH' 'REVIEW_PATH' 'PR_BODY_PATH' 'implement-<slug>.json' 'review-<slug>.json' 'pr-body-<slug>.md' 'Review level: <level> (size <X>)'; do
    run rg_or_grep -F -- "$p" "$SKILL/SKILL.md"
    [ "$status" -eq 0 ]
  done
  for absent in 'design-to-spec' 'difficulty' 'spec-driven-delivery' 'SHIP: false' 'invoke by name'; do
    run rg_or_grep -F -- "$absent" "$SKILL/SKILL.md"
    [ "$status" -ne 0 ]
  done
  run bash -c "wc -l < '$SKILL/SKILL.md' | tr -d '[:space:]'"
  [ "$output" -lt 500 ]
}

@test "build-task design-pipeline usage references exist and document their contracts" {
  for f in explore.md design.md spec.md; do
    [ -s "$BT_WF/$f" ]
    for p in 'taskflow:build-task-' 'args global is undefined' 'const args = { … }' "stage: 'args'"; do
      run rg_or_grep -F -- "$p" "$BT_WF/$f"
      [ "$status" -eq 0 ]
    done
    run rg_or_grep -F 'claude-opus-4-8' "$BT_WF/$f"
    [ "$status" -ne 0 ]
    run rg_or_grep -F 'design-to-spec' "$BT_WF/$f"
    [ "$status" -ne 0 ]
  done
  for p in '`TASK`' '`EXPLORE_PATH`' '`GRAPHMIND_AVAILABLE`' '`REPO_PATH`' '`explorePath`' '`subsystems`' 'haiku'; do
    run rg_or_grep -F -- "$p" "$BT_WF/explore.md"
    [ "$status" -eq 0 ]
  done
  for p in '`EXPLORE_PATH`' '`DRAFT_PATH`' '`SIZE`' '`RESUME`' '`USER_INPUT`' '`user_input_required`' '`minorFindings`' 'fable' '`GRAPHMIND_AVAILABLE` only adds a hint to the designer and design-reviewer prompts'; do
    run rg_or_grep -F -- "$p" "$BT_WF/design.md"
    [ "$status" -eq 0 ]
  done
  for p in '`DRAFT_PATH`' '`SPEC_PATH`' '`specPath`' '`specReviewed`' '`minorFindings`'; do
    run rg_or_grep -F -- "$p" "$BT_WF/spec.md"
    [ "$status" -eq 0 ]
  done
}

# --- workflows/ ---

@test "the plugin workflow scripts exist and declare export const meta" {
  for f in changes-review.workflow.js; do
    [ -s "$WORKFLOWS/$f" ]
    run rg_or_grep -F 'export const meta = {' "$WORKFLOWS/$f"
    [ "$status" -eq 0 ]
  done
  [ ! -e "$WORKFLOWS/spec-driven-delivery.workflow.js" ]
}

@test "workflow meta names match their filenames" {
  run rg_or_grep -E "name:[[:space:]]*[\"']changes-review[\"']" "$WORKFLOWS/changes-review.workflow.js"
  [ "$status" -eq 0 ]
}

@test "workflow scripts guard args via a decodeArgs fail-fast" {
  for f in changes-review.workflow.js; do
    run rg_or_grep -F 'function decodeArgs' "$WORKFLOWS/$f"
    [ "$status" -eq 0 ]
    run rg_or_grep -E "stage:[[:space:]]*[\"']args[\"']" "$WORKFLOWS/$f"
    [ "$status" -eq 0 ]
  done
}

@test "workflow scripts contain no leftover German comments" {
  for f in changes-review.workflow.js; do
    run rg_or_grep -cE '[äöüßÄÖÜ]' "$WORKFLOWS/$f"
    [ "$status" -ne 0 ] || [ "$output" -eq 0 ]
    # ASCII-only German (no diacritics, e.g. "// wenn ..."): scan comment text
    # only, for common unambiguous German stopwords, word-bounded.
    run bash -c "rg_or_grep -oE '//.*' '$WORKFLOWS/$f' | rg_or_grep -icE '\\b(und|oder|nicht|wird|werden|auch|sowie|sind|eine|einen|kein|keine|wenn|dass|immer|nie|schritt)\\b'"
    [ "$status" -ne 0 ] || [ "$output" -eq 0 ]
  done
}

@test "every agentType referenced by the workflows has a matching agents/*.md file" {
  for f in "$WORKFLOWS/changes-review.workflow.js" "$WORKFLOWS/build-task-review.workflow.js"; do
    for name in $(rg_or_grep -oE "taskflow:[a-z-]+" "$f" | sed 's/taskflow://' | sort -u); do
      [ -f "$AGENTS_DIR/$name.md" ]
    done
  done
}

@test "the plugin workflow scripts forbid narrative text in every inline (non-agentType) prompt" {
  run rg_or_grep -F 'const NO_NARRATION' "$WORKFLOWS/changes-review.workflow.js"
  [ "$status" -eq 0 ]
  followed_by 'NO_NARRATION' '+ "\n\n' "$WORKFLOWS/changes-review.workflow.js"
  for p in 'schema: SCOPE_SCHEMA' 'schema: REPORT_SCHEMA' 'ponytailReviewPrompt ='; do
    run rg_or_grep -F "$p" "$WORKFLOWS/changes-review.workflow.js"
    [ "$status" -eq 0 ]
  done
}

# --- build-task design-pipeline scripts (skills/build-task/workflows/*.workflow.js) ---

@test "explore.workflow.js: meta, args guard, NO_NARRATION on every prompt, graphmind path, scribe" {
  F="$WORKFLOWS/build-task-explore.workflow.js"
  [ -s "$F" ]
  for p in 'export const meta = {' 'name: "build-task-explore"' 'function decodeArgs' 'decodeArgs(["TASK", "EXPLORE_PATH"], { GRAPHMIND_AVAILABLE: false, REPO_PATH: "" })' 'const NO_NARRATION = "No narrative text between tool calls — call tools silently and speak only in your final message (the report or structured output).";' 'scoutPrompt = `${NO_NARRATION}' '`${NO_NARRATION}\n\nYou are a read-only codebase explorer' 'seenProposedNames' 'explorer: "haiku"' 'scribe: "haiku"' 'required: ["subsystems"]' 'mcp__graphmind__gm_search' 'mcp__graphmind__gm_memory_search' 'project: "${REPO}"' 'GRAPHMIND_AVAILABLE=true requires a non-empty absolute REPO_PATH' '## Recorded project knowledge (graphmind memory)' 'scribePrompt = `${NO_NARRATION}' '<<<BEGIN>>>' 'label: "scribe:retry"' 'scribe could not write EXPLORE_PATH' 'explorePath: EXPLORE_PATH'; do
    run rg_or_grep -F -- "$p" "$F"
    [ "$status" -eq 0 ]
  done
  followed_by 'graphmindExplorePrompt = (s) =>' '`${NO_NARRATION}\n\nYou are a read-only codebase explorer' "$F"
  followed_by 'graphmindRecallPrompt = () =>' '`${NO_NARRATION}' "$F"
  followed_by 'explorerPrompt = (s) =>' '`${NO_NARRATION}' "$F"
  for absent in 'difficulty' 'resumeNote' 'AGENTS' 'taskflow:' 'DRAFT_PATH' 'SPEC_PATH'; do
    run rg_or_grep -F -- "$absent" "$F"
    [ "$status" -ne 0 ]
  done
  # the only agentType allowed in the design pipeline is the built-in Explore agent
  run bash -c "grep -n 'agentType' '$F' | grep -v 'agentType: \"Explore\"' || true"
  [ "$output" = "" ]
}

@test "build-task design-pipeline scripts parse as async function bodies" {
  run node -e 'const fs=require("fs");for(const f of process.argv.slice(1)){new (Object.getPrototypeOf(async function(){}).constructor)(fs.readFileSync(f,"utf8").replace(/^export /m,""))}' "$WORKFLOWS"/build-task-*.workflow.js
  [ "$status" -eq 0 ]
}

@test "design.workflow.js: args guards, SIZE-keyed designer model, role files by absolute path, inline prompts" {
  F="$WORKFLOWS/build-task-design.workflow.js"
  [ -s "$F" ]
  for p in 'export const meta = {' 'name: "build-task-design"' 'function decodeArgs' 'decodeArgs(["TASK", "EXPLORE_PATH", "DRAFT_PATH"], { SIZE: "", RESUME: false, USER_INPUT: "" })' 'RESUME=true requires USER_INPUT' 'const DESIGN_MODEL = { S: "sonnet", M: "opus", L: "opus", XL: "fable" };' 'const designerModel = (s) => DESIGN_MODEL[String(s).toUpperCase()] || "opus";' 'let DESIGNER_MODEL = designerModel(SIZE);' 'model: DESIGNER_MODEL' 'designReview: "sonnet"' 'if (DESIGNER_MODEL !== "fable") throw e;' 'DESIGNER_MODEL = "opus";' 'function hasContaminatedKeypoints' 'if (d === null || hasContaminatedKeypoints(d))' 'never embedded as text/tags' 'agentType: "taskflow:designer"' 'agentType: "taskflow:design-reviewer"' 'Read the exploration file at ${EXPLORE_PATH} before designing' 'per your role' 'Apply your full checklist (role definition)' 'status: "user_input_required"' 'Re-run this workflow with RESUME=true, the same DRAFT_PATH and EXPLORE_PATH, and the answers as USER_INPUT (recommended: JSON [{id, answer}]).' 'minorFindings: (review.findings || []).filter((f) => f.severity === "minor")'; do
    run rg_or_grep -F -- "$p" "$F"
    [ "$status" -eq 0 ]
  done
  for absent in 'difficulty' 'AGENTS' 'ROLE' 'SKILL_DIR' 'NO_NARRATION' 'explorationBlock' 'phase("Spec")' 'phase("Explore")' 'agent definition'; do
    run rg_or_grep -F -- "$absent" "$F"
    [ "$status" -ne 0 ]
  done
}

@test "spec.workflow.js: inline spec writer/reviewer, English, lean carry-forward, specReviewed" {
  F="$WORKFLOWS/build-task-spec.workflow.js"
  [ -s "$F" ]
  for p in 'export const meta = {' 'name: "build-task-spec"' 'function decodeArgs' 'decodeArgs(["DRAFT_PATH", "SPEC_PATH"], {})' 'specWriter: "sonnet"' 'specReview: "sonnet"' 'specReviewerPrompt = `${NO_NARRATION}' 'function reviewSpec' 'function writeSpec' 'specReviewed: specCheck != null' 'lean/YAGNI decisions forward' 'English' 'specPath: SPEC_PATH'; do
    run rg_or_grep -F -- "$p" "$F"
    [ "$status" -eq 0 ]
  done
  followed_by 'specWriterPrompt = (revision) =>' '`${NO_NARRATION}' "$F"
  for absent in 'agentType' 'difficulty' 'AGENTS' 'taskflow:' 'TASK' 'EXPLORE_PATH'; do
    run rg_or_grep -F -- "$absent" "$F"
    [ "$status" -ne 0 ]
  done
}

@test "build-task scripts: meta, decodeArgs fail-fast, NO_NARRATION, no plugin agent types (review excepted), clean comments" {
  run bash -c "ls '$WORKFLOWS'/build-task-*.workflow.js | wc -l | tr -d '[:space:]'"
  [ "$output" = "7" ]
  for n in explore design spec plan implement review ship; do
    f="$WORKFLOWS/build-task-$n.workflow.js"
    [ -s "$f" ]
    run rg_or_grep -F 'export const meta = {' "$f"
    [ "$status" -eq 0 ]
    run rg_or_grep -E "name:[[:space:]]*[\"']build-task-$n[\"']" "$f"
    [ "$status" -eq 0 ]
    if [ "$n" != design ]; then
      run rg_or_grep -F 'const NO_NARRATION = "No narrative text between tool calls — call tools silently and speak only in your final message (the report or structured output).";' "$f"
      [ "$status" -eq 0 ]
    fi
    run rg_or_grep -F 'function decodeArgs' "$f"
    [ "$status" -eq 0 ]
    run rg_or_grep -F 'args global is ' "$f"
    [ "$status" -eq 0 ]
    run rg_or_grep -E "stage:[[:space:]]*[\"']args[\"']" "$f"
    [ "$status" -eq 0 ]
    for absent in 'Date.now()' 'Math.random()' 'new Date()'; do
      run rg_or_grep -F -- "$absent" "$f"
      [ "$status" -ne 0 ]
    done
    if [ "$n" = explore ] || [ "$n" = spec ]; then
      for absent in 'agentType: AGENTS.' 'taskflow:'; do
        run rg_or_grep -F -- "$absent" "$f"
        [ "$status" -ne 0 ]
      done
    fi
    run rg_or_grep -E '^import ' "$f"
    [ "$status" -ne 0 ]
    run rg_or_grep -cE '[äöüßÄÖÜ]' "$f"
    [ "$status" -ne 0 ] || [ "$output" -eq 0 ]
    run bash -c "rg_or_grep -oE '//.*' '$f' | rg_or_grep -icE '\\b(und|oder|nicht|wird|werden|auch|sowie|sind|eine|einen|kein|keine|wenn|dass|immer|nie|schritt)\\b'"
    [ "$status" -ne 0 ] || [ "$output" -eq 0 ]
  done
}

@test "eslint.config.mjs ignores *.workflow.js (top-level await/return, not a standalone module)" {
  run rg_or_grep -F '*.workflow.js' "$ESLINT_CONFIG"
  [ "$status" -eq 0 ]
}

@test "designer and planner role files require English output regardless of input language" {
  run rg_or_grep -iF 'English' "$BT_ROLES/designer.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'English' "$BT_ROLES/planner.md"
  [ "$status" -eq 0 ]
}

# --- agents ---

AGENT_NAMES="review-finder review-verifier fix-applier"

@test "all 3 agent files exist with matching name frontmatter" {
  for a in $AGENT_NAMES; do
    [ -f "$AGENTS_DIR/$a.md" ]
    run rg_or_grep -E "^name:[[:space:]]*$a\$" "$AGENTS_DIR/$a.md"
    [ "$status" -eq 0 ]
  done
}

@test "all agent files declare a model; the three review agents run on sonnet" {
  for a in $AGENT_NAMES; do
    run rg_or_grep -E '^model: sonnet$' "$AGENTS_DIR/$a.md"
    [ "$status" -eq 0 ]
  done
}

@test "all agent descriptions are exactly INTERNAL ONLY (no model auto-selection)" {
  for a in $AGENT_NAMES; do
    run rg_or_grep -x 'description: INTERNAL ONLY' "$AGENTS_DIR/$a.md"
    [ "$status" -eq 0 ]
  done
}

@test "all agent files forbid narrative text between tool calls" {
  for a in $AGENT_NAMES; do
    run rg_or_grep -F 'No narrative text between tool calls' "$AGENTS_DIR/$a.md"
    [ "$status" -eq 0 ]
  done
}

@test "read-only-declared agents carry a least-privilege tools allowlist without Write/Edit" {
  for a in review-finder review-verifier; do
    run rg_or_grep -E '^tools:' "$AGENTS_DIR/$a.md"
    [ "$status" -eq 0 ]
    run rg_or_grep -E "^tools:.*[[:space:],\\[\\]\"'](Write|Edit)([[:space:],\\[\\]\"']|\$)" "$AGENTS_DIR/$a.md"
    [ "$status" -ne 0 ]
  done
}

@test "fix-applier checks the current branch matches the work branch, not primary-vs-worktree" {
  run rg_or_grep -F 'git branch' "$AGENTS_DIR/fix-applier.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F -- '--show-current' "$AGENTS_DIR/fix-applier.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'NOT a linked worktree' "$AGENTS_DIR/fix-applier.md"
  [ "$status" -ne 0 ]
}

@test "worktree-merger checks the current branch before merging, not primary-vs-worktree" {
  run rg_or_grep -F 'Before merging anything' "$BT_ROLES/worktree-merger.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'not a worktree' "$BT_ROLES/worktree-merger.md"
  [ "$status" -ne 0 ]
}

@test "build-task SKILL.md stays on the current branch when resuming an existing worktree/PR" {
  run rg_or_grep -iF 'existing worktree' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "build-task SKILL.md documents the --skip-branch-check prefix flag" {
  run rg_or_grep -F -- '--skip-branch-check' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "build-task SKILL.md allowed-tools includes EnterWorktree" {
  run rg_or_grep -E '^allowed-tools:.*EnterWorktree' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "build-task step 1 creates a feature/<slug> worktree via EnterWorktree name" {
  run rg_or_grep -F 'EnterWorktree` with `name: "<slug>"`' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'git branch -m "feature/<slug>"' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'select:EnterWorktree' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  # a path-entered `git worktree add` worktree cannot be removed by ExitWorktree
  run rg_or_grep -F 'git worktree add' "$SKILL/SKILL.md"
  [ "$status" -ne 0 ]
  run rg_or_grep -F 'git checkout -b' "$SKILL/SKILL.md"
  [ "$status" -ne 0 ]
  run rg_or_grep -F 'git worktree list --porcelain' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'check-ignore -q' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "taskflow docs describe build-task worktree creation" {
  run rg_or_grep -F 'creates a `feature/<slug>` worktree' "$PLUGIN/CLAUDE.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'creates a `feature/<slug>` worktree' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'only creates a `feature/<slug>` worktree' "$DISPATCH/CLAUDE.md"
  [ "$status" -eq 0 ]
}

@test "fix-applier applies and tests fixes per-fix before a single category commit" {
  run rg_or_grep -iF 'PER-FIX' "$AGENTS_DIR/fix-applier.md"
  [ "$status" -eq 0 ]
}

@test "ci-monitor collects a rerunId per failed job; ci-fixer consumes it" {
  run rg_or_grep -F 'rerunId' "$BT_ROLES/ci-monitor.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'rerunId' "$BT_ROLES/ci-fixer.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'rerunId' "$WORKFLOWS/build-task-ship.workflow.js"
  [ "$status" -eq 0 ]
}

@test "the designer prompt and role file both disambiguate openQuestions as its own structured-output field" {
  run rg_or_grep -F 'never embedded as text/tags' "$WORKFLOWS/build-task-design.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'never write `openQuestions` as text or tags' "$BT_ROLES/designer.md"
  [ "$status" -eq 0 ]
}

@test "review script guards agent array fields before iterating" {
  run rg_or_grep -F 'r.verdicts || []' "$WORKFLOWS/build-task-review.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'Array.isArray(r.candidates)' "$WORKFLOWS/build-task-review.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'Array.isArray(sweep.candidates)' "$WORKFLOWS/build-task-review.workflow.js"
  [ "$status" -eq 0 ]
}

# --- Model assignment: unpinned family aliases + difficulty classifier ---

@test "workflow model tiers are unpinned to bare aliases with the size-keyed model maps present" {
  for p in 'const DESIGN_MODEL = { S: "sonnet", M: "opus", L: "opus", XL: "fable" };' 'const designerModel = (s) => DESIGN_MODEL[String(s).toUpperCase()] || "opus";' 'model: DESIGNER_MODEL'; do
    run rg_or_grep -F -- "$p" "$WORKFLOWS/build-task-design.workflow.js"
    [ "$status" -eq 0 ]
  done
  for p in 'const PLAN_MODEL = { S: "sonnet", M: "opus", L: "opus", XL: "fable" };' 'const plannerModel = (s) => PLAN_MODEL[String(s).toUpperCase()] || "opus";' 'model: PLANNER_MODEL'; do
    run rg_or_grep -F -- "$p" "$WORKFLOWS/build-task-plan.workflow.js"
    [ "$status" -eq 0 ]
  done
  run bash -c "grep -l 'PINNED_OPUS' '$WORKFLOWS'/build-task-*.workflow.js '$WORKFLOWS'/*.workflow.js || true"
  [ "$output" = "" ]
  run rg_or_grep -F 'synthesizer: "opus"' "$WORKFLOWS/build-task-review.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'synthesizer: "opus"' "$WORKFLOWS/changes-review.workflow.js"
  [ "$status" -eq 0 ]
}

@test "explore scout schema carries no difficulty; the designer model comes from build-task's SIZE" {
  run rg_or_grep -F 'required: ["subsystems"]' "$WORKFLOWS/build-task-explore.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'difficulty' "$WORKFLOWS/build-task-explore.workflow.js"
  [ "$status" -ne 0 ]
  run rg_or_grep -F 'let DESIGNER_MODEL = designerModel(SIZE)' "$WORKFLOWS/build-task-design.workflow.js"
  [ "$status" -eq 0 ]
}

@test "design.workflow.js designer dispatch falls back from fable to opus on a throw" {
  run rg_or_grep -F 'if (DESIGNER_MODEL !== "fable") throw e;' "$WORKFLOWS/build-task-design.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'DESIGNER_MODEL = "opus";' "$WORKFLOWS/build-task-design.workflow.js"
  [ "$status" -eq 0 ]
}

@test "sonnet and haiku workflow assignments stay bare aliases" {
  run rg_or_grep -F 'explorer: "haiku"' "$WORKFLOWS/build-task-explore.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'merger: "haiku"' "$WORKFLOWS/build-task-implement.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'const implModel = (t) => (t.complexity === "complex" ? "opus" : "haiku");' "$WORKFLOWS/build-task-implement.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'planChecker: "sonnet"' "$WORKFLOWS/build-task-plan.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'finder: "sonnet"' "$WORKFLOWS/changes-review.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'applier: "sonnet"' "$WORKFLOWS/build-task-review.workflow.js"
  [ "$status" -eq 0 ]
}

@test "workflows/CLAUDE.md's Model assignment section drops the Opus pin and documents the classifier" {
  section="$BATS_TEST_TMPDIR/model-assignment.md"
  awk '/^## Model assignment$/{f=1;next} /^## /{f=0} f' "$WORKFLOWS/CLAUDE.md" > "$section"
  [ -s "$section" ]
  run rg_or_grep -F 'claude-opus-4-8' "$section"
  [ "$status" -ne 0 ]
  run rg_or_grep -F '2026-08-12' "$section"
  [ "$status" -ne 0 ]
  run rg_or_grep -iF 'exception' "$section"
  [ "$status" -ne 0 ]
  run rg_or_grep -F '`sonnet`/`haiku`' "$section"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'fable' "$section"
  [ "$status" -eq 0 ]
}

@test "README and the design/delivery usage references carry no pinned model ID and name fable" {
  for f in "$PLUGIN/README.md" "$BT_WF/design.md" "$BT_WF/plan.md" "$BT_WF/implement.md" "$BT_WF/review.md" "$BT_WF/ship.md"; do
    run rg_or_grep -F 'claude-opus-4-8' "$f"
    [ "$status" -ne 0 ]
  done
  for f in "$PLUGIN/README.md" "$BT_WF/design.md" "$BT_WF/plan.md"; do
    run rg_or_grep -F 'fable' "$f"
    [ "$status" -eq 0 ]
  done
}

@test "no claude-opus-4-8 pin survives anywhere in the plugin" {
  run bash -c "grep -rn 'claude-opus-4-8' '$PLUGIN' || true"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

# --- dispatch-task skill ---

@test "dispatch-task SKILL.md exists and is non-empty" {
  [ -s "$DISPATCH/SKILL.md" ]
}

@test "dispatch-task frontmatter declares name, arguments and the minimal allowed-tools" {
  fm="$BATS_TEST_TMPDIR/dispatch-task-frontmatter.txt"
  sed -n '/^---$/,/^---$/p' "$DISPATCH/SKILL.md" > "$fm"
  [ -s "$fm" ]
  for pat in 'name: dispatch-task' 'arguments: task_description' '"Bash"' '"AskUserQuestion"'; do
    run rg_or_grep -F "$pat" "$fm"
    [ "$status" -eq 0 ]
  done
  for pat in '"Agent"' '"Skill"' '"Bash(git:*)"' 'TaskCreate'; do
    run rg_or_grep -F "$pat" "$fm"
    [ "$status" -ne 0 ]
  done
}

@test "dispatch-task is user-only (disable-model-invocation: true)" {
  run rg_or_grep -E '^disable-model-invocation:[[:space:]]*true' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "dispatch-task skill dir is self-contained (no cross-plugin references; CLAUDE.md dev notes excluded)" {
  run bash -c "grep -riE --exclude=CLAUDE.md 'coding-toolbox|dispatch-agent|superpowers|branch-management' '$DISPATCH'"
  [ "$status" -eq 1 ]
}

@test "dispatch-task supports --model/--effort overrides, defaults sonnet/xhigh, and forces permission-mode auto" {
  for pat in 'claude --worktree' '--bg' '--model=<model>' '--effort=<effort>' 'sonnet' 'xhigh' '--permission-mode auto'; do
    run rg_or_grep -F -- "$pat" "$DISPATCH/SKILL.md"
    [ "$status" -eq 0 ]
  done
}

@test "dispatch-task validates model/effort as safe bare tokens before shell substitution" {
  run rg_or_grep -F -- '^[A-Za-z0-9._-]+$' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "dispatch-task constructs the command line with validated, not raw, model/effort values" {
  run rg_or_grep -F -- 'claude --worktree "$name" --model "<validated-model>" --effort "<validated-effort>" --permission-mode auto --bg' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "dispatch-task and its CLAUDE.md document worktree.baseRef instead of assuming the default branch unconditionally" {
  run rg_or_grep -F 'worktree.baseRef' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '"head"' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'worktree.baseRef' "$DISPATCH/CLAUDE.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '"head"' "$DISPATCH/CLAUDE.md"
  [ "$status" -eq 0 ]
}

@test "dispatch-task/CLAUDE.md documents the --skip-branch-check flag" {
  run rg_or_grep -F -- '--skip-branch-check' "$DISPATCH/CLAUDE.md"
  [ "$status" -eq 0 ]
}

@test "dispatch-task hardens the session name and any interpolated value" {
  run rg_or_grep -F 'RANDOM' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'date +%s' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '^[A-Za-z0-9._-]+$' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "dispatch-task hands the background session /taskflow:build-task inside a quoted heredoc" {
  run rg_or_grep -F '/taskflow:build-task' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E "<<[[:space:]]?'DISPATCH_TASK_PROMPT_" "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "dispatch-task uses a fixed heredoc delimiter (no fragile per-invocation token)" {
  # RC1 fix: the old "fresh delimiter per invocation" mandate forced the model to
  # invent and reproduce a token identically twice; a mismatch broke the heredoc and
  # the background job failed to launch. The delimiter is now the fixed EOF literal.
  run rg_or_grep -iF 'never reuse a fixed literal' "$DISPATCH/SKILL.md"
  [ "$status" -ne 0 ]
  run rg_or_grep -iF 'fresh heredoc' "$DISPATCH/SKILL.md"
  [ "$status" -ne 0 ]
  run rg_or_grep -E "<<[[:space:]]?'DISPATCH_TASK_PROMPT_EOF'" "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "dispatch-task cuts a properly named feature/<slug> branch before invoking build-task" {
  run rg_or_grep -F 'git checkout -b' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'feature/<' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "dispatch-task payload passes --skip-branch-check to build-task" {
  run rg_or_grep -F -- '/taskflow:build-task --skip-branch-check' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "plugin README lists dispatch-task in the Skills section" {
  run rg_or_grep -F '| `dispatch-task`' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
}

# --- changes-audit skill ---

@test "changes-audit SKILL.md exists and is non-empty" {
  [ -s "$CHANGES_AUDIT/SKILL.md" ]
}

@test "changes-audit frontmatter: name, description, argument-hint; model-invocable; not forked" {
  run rg_or_grep -E '^name:[[:space:]]*changes-audit' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^description:' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^argument-hint:' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^disable-model-invocation:[[:space:]]*true' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -ne 0 ]
  run rg_or_grep -E '^context:[[:space:]]*fork' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "changes-audit allowed-tools includes Workflow, Agent, AskUserQuestion" {
  run rg_or_grep -E '^allowed-tools:.*Workflow' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^allowed-tools:.*Agent' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^allowed-tools:.*AskUserQuestion' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "changes-audit parses --fix, invokes the review workflow, dispatches fix-applier" {
  run rg_or_grep -F -- '--fix' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'AskUserQuestion' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'taskflow:changes-review' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'taskflow:fix-applier' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "changes-audit SKILL.md never contains a load-time exclamation-backtick sequence" {
  run rg_or_grep -F '!`' "$CHANGES_AUDIT/SKILL.md"
  [ "$status" -ne 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# bin/ship-ensure-mergeable.sh — hermetic exit-code / mergeState contract.
# Stubs gh/glab (canned JSON, call recording); real git for the conflict path.
# NOTE: the script's `env -i` in run_mergeable wipes everything except
# PATH/HOME/TMPDIR — stub bodies must use $TMPDIR, never $BATS_TEST_TMPDIR.
# MERGE_SCRIPT is resolved in setup() (top-level assignment can't see $PLUGIN).
# ─────────────────────────────────────────────────────────────────────────────

mm_mockbin() {
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash env grep sed git jq sleep cat rm mkdir printf head cut tr; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -sf "$src" "$MOCKBIN/$t"
  done
  export HOME="$BATS_TEST_TMPDIR/home"; mkdir -p "$HOME"
}

mm_stub() {
  local name="$1"; shift
  rm -f "$MOCKBIN/$name"
  { printf '#!/usr/bin/env bash\n'; printf '%s\n' "$@"; } > "$MOCKBIN/$name"
  chmod +x "$MOCKBIN/$name"
}

run_mergeable() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    SHIP_MERGE_POLL_INTERVAL=0 SHIP_MERGE_POLL_RETRIES=2 \
    bash "$MERGE_SCRIPT" "$@"
}

# Build a real git repo with a bare origin. Advances `main` past `feature`;
# $1 = "conflict" (conflicting hunk, -X ours resolvable) or
#      "modifydelete" (base deletes f.txt, feature edits it — NOT -X ours
#      resolvable, leaves an unmerged path).
mm_git_fixture() {
  local kind="$1" origin="$BATS_TEST_TMPDIR/origin.git" work="$BATS_TEST_TMPDIR/work"
  git init -q --bare "$origin"
  git clone -q "$origin" "$work"
  cd "$work" || return 1
  git config user.email t@t; git config user.name t
  printf 'base\n' > f.txt; git add f.txt; git commit -qm init
  git branch -M main; git push -q origin main
  git checkout -q -b feature
  printf 'feature-change\n' > f.txt; git commit -qam feature
  git push -q origin feature
  git checkout -q main
  if [ "$kind" = "modifydelete" ]; then
    git rm -q f.txt; git commit -qm 'base deletes f'
  else
    printf 'base-change\n' > f.txt; git commit -qam 'base advances'
  fi
  git push -q origin main
  git checkout -q feature
}

@test "ship-ensure-mergeable.sh exists and is executable" {
  [ -f "$MERGE_SCRIPT" ]
  [ -x "$MERGE_SCRIPT" ]
}

@test "ship-ensure-mergeable.sh rejects a wrong argument count with exit 64" {
  mm_mockbin
  run_mergeable github feature main
  [ "$status" -eq 64 ]
}

@test "ship-ensure-mergeable.sh: clean GitHub state → mergeState=clean, no mutation" {
  mm_mockbin
  mm_stub gh '
    echo "ARGS: $*" >> "$TMPDIR/gh-calls"
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo "{\"mergeable\":\"MERGEABLE\",\"mergeStateStatus\":\"CLEAN\"}"; exit 0
    fi
    exit 0'
  run_mergeable github feature main 42
  [ "$status" -eq 0 ]
  [[ "$output" == *"mergeState=clean"* ]]
  run grep -F 'update-branch' "$BATS_TEST_TMPDIR/gh-calls"
  [ "$status" -ne 0 ]
}

@test "ship-ensure-mergeable.sh: BEHIND GitHub → gh pr update-branch → mergeState=rebased" {
  mm_mockbin
  mm_stub gh '
    n_file="$TMPDIR/gh-n"; n=$(cat "$n_file" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$n_file"
    echo "ARGS: $*" >> "$TMPDIR/gh-calls"
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      if [ "$n" -le 1 ]; then echo "{\"mergeable\":\"UNKNOWN\",\"mergeStateStatus\":\"BEHIND\"}";
      else echo "{\"mergeable\":\"MERGEABLE\",\"mergeStateStatus\":\"CLEAN\"}"; fi
      exit 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "update-branch" ]; then exit 0; fi
    exit 0'
  run_mergeable github feature main 42
  [ "$status" -eq 0 ]
  [[ "$output" == *"mergeState=rebased"* ]]
  run grep -F 'pr update-branch 42' "$BATS_TEST_TMPDIR/gh-calls"
  [ "$status" -eq 0 ]
}

@test "ship-ensure-mergeable.sh: need_rebase GitLab → rebase API → mergeState=rebased" {
  mm_mockbin
  mm_stub glab '
    n_file="$TMPDIR/glab-n"; n=$(cat "$n_file" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$n_file"
    echo "ARGS: $*" >> "$TMPDIR/glab-calls"
    # PUT rebase call
    if [ "$1" = "api" ] && [ "$2" = "-X" ] && [ "$3" = "PUT" ]; then exit 0; fi
    # single-MR GET
    if [ "$n" -le 1 ]; then echo "{\"detailed_merge_status\":\"need_rebase\",\"merge_status\":\"cannot_be_merged\",\"rebase_in_progress\":false,\"merge_error\":null}";
    else echo "{\"detailed_merge_status\":\"mergeable\",\"merge_status\":\"can_be_merged\",\"rebase_in_progress\":false,\"merge_error\":null}"; fi
    exit 0'
  run_mergeable gitlab feature main 7
  [ "$status" -eq 0 ]
  [[ "$output" == *"mergeState=rebased"* ]]
  run grep -F 'merge_requests/7/rebase' "$BATS_TEST_TMPDIR/glab-calls"
  [ "$status" -eq 0 ]
}

@test "ship-ensure-mergeable.sh: -X ours-resolvable conflict → merge + non-force push → mergeState=resolved" {
  mm_mockbin
  mm_git_fixture conflict
  mm_stub gh '
    n_file="$TMPDIR/gh-n"; n=$(cat "$n_file" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$n_file"
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      if [ "$n" -le 1 ]; then echo "{\"mergeable\":\"CONFLICTING\",\"mergeStateStatus\":\"DIRTY\"}";
      else echo "{\"mergeable\":\"MERGEABLE\",\"mergeStateStatus\":\"CLEAN\"}"; fi
      exit 0
    fi
    exit 0'
  run_mergeable github feature main 42
  [ "$status" -eq 0 ]
  [[ "$output" == *"mergeState=resolved"* ]]
  # -X ours kept the feature side of the conflicting hunk
  run cat "$BATS_TEST_TMPDIR/work/f.txt"
  [[ "$output" == *"feature-change"* ]]
}

@test "ship-ensure-mergeable.sh: conflict NOT -X ours-resolvable → abort, no push, exit 1" {
  mm_mockbin
  mm_git_fixture modifydelete
  local origin_before
  origin_before="$(git -C "$BATS_TEST_TMPDIR/work" rev-parse origin/feature)"
  mm_stub gh '
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo "{\"mergeable\":\"CONFLICTING\",\"mergeStateStatus\":\"DIRTY\"}"; exit 0
    fi
    exit 0'
  run_mergeable github feature main 42
  [ "$status" -eq 1 ]
  # merge was aborted → no unmerged paths remain
  run git -C "$BATS_TEST_TMPDIR/work" ls-files --unmerged
  [ -z "$output" ]
  # origin/feature was NOT pushed to (remote unchanged)
  run git -C "$BATS_TEST_TMPDIR/work" rev-parse origin/feature
  [ "$output" = "$origin_before" ]
}

@test "ship-ensure-mergeable.sh: remediation error (update-branch fails) → exit 1" {
  mm_mockbin
  mm_stub gh '
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo "{\"mergeable\":\"UNKNOWN\",\"mergeStateStatus\":\"BEHIND\"}"; exit 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "update-branch" ]; then echo "boom" >&2; exit 1; fi
    exit 0'
  run_mergeable github feature main 42
  [ "$status" -eq 1 ]
}

@test "ship-ensure-mergeable.sh: transient read error → mergeState=unknown, exit 0" {
  mm_mockbin
  mm_stub gh 'echo "api down" >&2; exit 1'
  run_mergeable github feature main 42
  [ "$status" -eq 0 ]
  [[ "$output" == *"mergeState=unknown"* ]]
}

@test "ship-ensure-mergeable.sh never issues a force push or a checkout --ours force-pick" {
  run grep -nE -- '--force|--force-with-lease|checkout[[:space:]]+--ours|checkout[[:space:]]+--theirs' "$MERGE_SCRIPT"
  [ "$status" -ne 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# Ship merge-state remediation wiring (script threaded through the pipeline).
# ─────────────────────────────────────────────────────────────────────────────

@test "SHIP_RESULT declares optional mergeState enum; status enum unchanged" {
  run rg_or_grep -F 'mergeState: { enum: ["clean", "rebased", "resolved", "unknown"] }' "$WORKFLOWS/build-task-ship.workflow.js"
  [ "$status" -eq 0 ]
  # mergeState is NOT required
  run rg_or_grep -F 'required: ["status"]' "$WORKFLOWS/build-task-ship.workflow.js"
  [ "$status" -eq 0 ]
}

@test "ship script decodes PLUGIN_ROOT and threads the script path into the shipper prompt" {
  run rg_or_grep -F 'PLUGIN_ROOT' "$WORKFLOWS/build-task-ship.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'ship-ensure-mergeable.sh' "$WORKFLOWS/build-task-ship.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'created.mergeState' "$WORKFLOWS/build-task-ship.workflow.js"
  [ "$status" -eq 0 ]
}

@test "ship script's final ship comment documents the optional mergeState field" {
  run rg_or_grep -F 'mergeState?' "$WORKFLOWS/build-task-ship.workflow.js"
  [ "$status" -eq 0 ]
}

@test "shipper references the remediation script, platform merge-state fields, and mergeState return" {
  run rg_or_grep -F 'ship-ensure-mergeable.sh' "$BT_ROLES/shipper.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'mergeStateStatus' "$BT_ROLES/shipper.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'detailed_merge_status' "$BT_ROLES/shipper.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'mergeState' "$BT_ROLES/shipper.md"
  [ "$status" -eq 0 ]
}

@test "build-task injects CLAUDE_PLUGIN_ROOT and passes PLUGIN_ROOT to the delivery workflow" {
  run rg_or_grep -F 'CLAUDE_PLUGIN_ROOT' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'PLUGIN_ROOT' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "build-task captures the plugin root via bare substitution, never a load-time shell injection" {
  run rg_or_grep -F 'Plugin root: ${CLAUDE_PLUGIN_ROOT}' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  # the reverted-anti-pattern this fixed: `!`-injecting $CLAUDE_PLUGIN_ROOT at
  # the actual context line fails outright (deterministically, unrecoverable by
  # retry) inside a worktree-isolated session — every dispatch-task-launched
  # run. See CLAUDE.md's "Fixed 2026-08-22". The load-time preprocessor does
  # NOT respect markdown code spans, so even a quoted prose mention of the
  # anti-pattern executes like the real thing (that exact regression shipped
  # in the 2026-08-22 fix and re-broke every dispatch: "Fixed 2026-08-23") —
  # assert the two-char sequence is absent from BOTH skill bodies entirely.
  run rg_or_grep -F '!`' "$SKILL/SKILL.md"
  [ "$status" -ne 0 ]
  run rg_or_grep -F '!`' "$DISPATCH/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "no reverted-alternative pr_stale/pr_conflict strings survive anywhere in the plugin" {
  run bash -c "grep -rnE 'pr_stale|pr_conflict' '$PLUGIN' || true"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "the agent roster is exactly 11 *.md files" {
  run bash -c "ls '$AGENTS_DIR'/*.md | wc -l | tr -d '[:space:]'"
  [ "$output" = "11" ]
}

@test "plugin README and layout document the changes-audit skill and changes-review workflow" {
  run rg_or_grep -F '| `changes-audit`' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '| `changes-review`' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'skills/changes-audit/' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'changes-review.workflow.js' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
}

@test "CLAUDE.md boundary rule and Opus-pin list cover changes-review and changes-audit" {
  run rg_or_grep -F 'changes-review.workflow.js' "$PLUGIN/CLAUDE.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'skills/changes-audit/' "$PLUGIN/CLAUDE.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '11 static role prompts' "$PLUGIN/CLAUDE.md"
  [ "$status" -eq 0 ]
}

@test "marketplace and root README mention the changes-audit entry point" {
  run rg_or_grep -F 'changes-audit' "$MARKET"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'changes-audit' "$REPO_ROOT/README.md"
  [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# §1 — PR/MR body handoff to a session-scratch file (pr-author → shipper).
# ─────────────────────────────────────────────────────────────────────────────

@test "build-task passes SCRATCH_DIR to the delivery workflow" {
  run rg_or_grep -F 'SCRATCH_DIR' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "PR_TEXT schema hands off bodyPath, not an inline body" {
  run rg_or_grep -F 'bodyPath: { type: "string" }' "$WORKFLOWS/build-task-ship.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'required: ["title", "bodyPath"]' "$WORKFLOWS/build-task-ship.workflow.js"
  [ "$status" -eq 0 ]
  # word-boundary form: a plain -F "prText.body" would substring-match the
  # surviving prText.bodyPath and never pass post-conversion.
  run rg_or_grep -e 'prText\.body\b' "$WORKFLOWS/build-task-ship.workflow.js"
  [ "$status" -ne 0 ]
  run rg_or_grep -F '<<<BODY' "$WORKFLOWS/build-task-ship.workflow.js"
  [ "$status" -ne 0 ]
}

@test "shipper reads the PR/MR body from a file, never retyping it" {
  run rg_or_grep -F -- '--body-file' "$BT_ROLES/shipper.md"
  [ "$status" -eq 0 ]
  # capital -F reads the file byte-exactly; lowercase -f body= must be gone.
  run rg_or_grep -F -- '-F body=@' "$BT_ROLES/shipper.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F -- '-f body=' "$BT_ROLES/shipper.md"
  [ "$status" -ne 0 ]
  run rg_or_grep -F -- '--description "$(cat' "$BT_ROLES/shipper.md"
  [ "$status" -eq 0 ]
}

@test "pr-author writes the body to a file via redirection and returns bodyPath" {
  run rg_or_grep -F 'bodyPath' "$BT_ROLES/pr-author.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'Bash redirection' "$BT_ROLES/pr-author.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'Return the title and body through the structured output schema' "$BT_ROLES/pr-author.md"
  [ "$status" -ne 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# §2 — Per-task test-evidence handoff to a session-scratch file
# (implementer → reviewer).
# ─────────────────────────────────────────────────────────────────────────────

@test "IMPL_RESULT hands off testEvidencePath, not an inline testEvidence transcript" {
  run rg_or_grep -F 'testEvidencePath: { type: "string" }' "$WORKFLOWS/build-task-implement.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '"testEvidencePath", "deviations"' "$WORKFLOWS/build-task-implement.workflow.js"
  [ "$status" -eq 0 ]
  # bare `testEvidence` is a substring of the new field — absence-check the exact
  # OLD required-array + property strings instead of the bare token.
  run rg_or_grep -F '"worktreePath", "testEvidence", "deviations"' "$WORKFLOWS/build-task-implement.workflow.js"
  [ "$status" -ne 0 ]
  run rg_or_grep -F 'testEvidence: { type: "string" }' "$WORKFLOWS/build-task-implement.workflow.js"
  [ "$status" -ne 0 ]
}

@test "implementer keeps its pinned prompt head and redirects test evidence to the derived path" {
  run followed_by 'implementerPrompt = (t, isolated) =>' '`${NO_NARRATION}' "$WORKFLOWS/build-task-implement.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'tevPathFor' "$WORKFLOWS/build-task-implement.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'test-evidence-task-' "$WORKFLOWS/build-task-implement.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'Bash redirection' "$WORKFLOWS/build-task-implement.workflow.js"
  [ "$status" -eq 0 ]
}

@test "reviewer reads test evidence from the file named by testEvidencePath" {
  run followed_by 'reviewerPrompt = (t, implReport, isolated) =>' '`${NO_NARRATION}' "$WORKFLOWS/build-task-implement.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'named by testEvidencePath' "$WORKFLOWS/build-task-implement.workflow.js"
  [ "$status" -eq 0 ]
}

@test "implement script isolates and merges only multi-task waves" {
  WF="$WORKFLOWS/build-task-implement.workflow.js"
  for p in 'isolated ? { isolation: "worktree" } : {}' 'runTask(waveTasks[0], false)' 'runTask(t, true)' 'if (isolated && approved.length)' 'single-task wave: no worktree, no merge step'; do
    run rg_or_grep -F -- "$p" "$WF"
    [ "$status" -eq 0 ]
  done
  run rg_or_grep -F 'even for wave size 1' "$WF"
  [ "$status" -ne 0 ]
}

@test "implement reference documents single-task waves, not always-isolated" {
  run rg_or_grep -F 'single-task wave' "$BT_WF/implement.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'even for single-task waves' "$BT_WF/implement.md"
  [ "$status" -ne 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# Documentation sync for the Ship merge-state remediation.
# ─────────────────────────────────────────────────────────────────────────────

@test "ship reference records mergeState in the ship contract and the auto-remediation roles" {
  run rg_or_grep -F 'mergeState?' "$BT_WF/ship.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'ship-ensure-mergeable' "$BT_WF/ship.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'never merges the PR/MR itself' "$BT_WF/ship.md"
  [ "$status" -eq 0 ]
}

@test "README shipper row and file tree document bin/ship-ensure-mergeable.sh" {
  run rg_or_grep -F 'ship-ensure-mergeable.sh' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'merge-state' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
}

@test "CLAUDE.md documents bin/ship-ensure-mergeable.sh alongside the 11-agent roster" {
  run rg_or_grep -F 'ship-ensure-mergeable.sh' "$PLUGIN/CLAUDE.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '11 static role prompts' "$PLUGIN/CLAUDE.md"
  [ "$status" -eq 0 ]
}

# --- ponytail design-phase enforcement ---

@test "designer prompt embeds the ponytail reuse ladder and the never-trim carve-out" {
  run rg_or_grep -iF 'reuse ladder' "$BT_ROLES/designer.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'stdlib' "$BT_ROLES/designer.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'No unrequested abstractions' "$BT_ROLES/designer.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'USER DECISION' "$BT_ROLES/designer.md"
  [ "$status" -eq 0 ]
}

@test "design-reviewer checklist includes the over-engineering (ponytail) item 8" {
  run rg_or_grep -iF 'Over-engineering (ponytail)' "$BT_ROLES/design-reviewer.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^8\.' "$BT_ROLES/design-reviewer.md"
  [ "$status" -eq 0 ]
}

@test "the spec-writer prompt carries the draft's lean/YAGNI decisions forward" {
  run rg_or_grep -iF 'lean/YAGNI decisions forward' "$WORKFLOWS/build-task-spec.workflow.js"
  [ "$status" -eq 0 ]
}

@test "the eight build-task roles are plugin agents (INTERNAL ONLY, no-narration paragraph); no role files remain" {
  for r in designer design-reviewer planner worktree-merger pr-author shipper ci-monitor ci-fixer; do
    [ -s "$AGENTS_DIR/$r.md" ]
    [ ! -e "$SKILL/roles/$r.md" ]
    run rg_or_grep -F "name: $r" "$AGENTS_DIR/$r.md"
    [ "$status" -eq 0 ]
    run rg_or_grep -F 'description: INTERNAL ONLY' "$AGENTS_DIR/$r.md"
    [ "$status" -eq 0 ]
    run rg_or_grep -E '^model: (haiku|sonnet|opus)$' "$AGENTS_DIR/$r.md"
    [ "$status" -eq 0 ]
    run rg_or_grep -F 'No narrative text between tool calls' "$AGENTS_DIR/$r.md"
    [ "$status" -eq 0 ]
    run rg_or_grep -F 'design-to-spec' "$AGENTS_DIR/$r.md"
    [ "$status" -ne 0 ]
    run rg_or_grep -F 'spec-driven-delivery' "$AGENTS_DIR/$r.md"
    [ "$status" -ne 0 ]
  done
  run rg_or_grep -F 'You are read-only: never use Write, Edit, NotebookEdit, or a Bash command that changes files or git state.' "$AGENTS_DIR/design-reviewer.md"
  [ "$status" -eq 0 ]
  [ ! -e "$WORKFLOWS/design-to-spec.workflow.js" ]
}

# --- ponytail report-only lean review (delivery pipeline) ---

@test "review script defines the lean-review schema, sonnet model, and returns ponytailReview" {
  run rg_or_grep -F 'PONYTAIL_REVIEW_SCHEMA' "$WORKFLOWS/build-task-review.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'ponytailReviewer: "sonnet"' "$WORKFLOWS/build-task-review.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'ponytailReview' "$WORKFLOWS/build-task-review.workflow.js"
  [ "$status" -eq 0 ]
}

@test "the lean-review step is scoped to over-engineering only and stays report-only" {
  run rg_or_grep -F 'over-engineering ONLY' "$WORKFLOWS/build-task-review.workflow.js"
  [ "$status" -eq 0 ]
  # report-only: the ponytail review is never routed to the fix applier
  run bash -c "grep -n 'ponytail' '$WORKFLOWS/build-task-review.workflow.js' | grep -i 'applier' || true"
  [ "$output" = "" ]
}

@test "lean-review findings are independently verified and deduped against the combined review" {
  run rg_or_grep -F 'verifyGroups(ponytailCandidates)' "$WORKFLOWS/build-task-review.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'combinedLocs' "$WORKFLOWS/build-task-review.workflow.js"
  [ "$status" -eq 0 ]
}

@test "changes-review workflow is review-only (no apply/ship/spec) and returns review + ponytailReview" {
  run rg_or_grep -F 'export const meta = {' "$WORKFLOWS/changes-review.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'stage: "done"' "$WORKFLOWS/changes-review.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'ponytailReview' "$WORKFLOWS/changes-review.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'synthesizer: "opus"' "$WORKFLOWS/changes-review.workflow.js"
  [ "$status" -eq 0 ]
  for absent in 'phase("Apply")' 'phase("Ship")' 'escalatedToUser' 'SPEC_PATH' 'taskflow:changes-review'; do
    run rg_or_grep -F "$absent" "$WORKFLOWS/changes-review.workflow.js"
    [ "$status" -ne 0 ]
  done
}

@test "pr-author documents the Lean review heading fed from the ponytail pass" {
  run rg_or_grep -iF 'Lean review' "$BT_ROLES/pr-author.md"
  [ "$status" -eq 0 ]
}

@test "review reference records the report-only lean (ponytail) review contract" {
  run rg_or_grep -F 'ponytailReview' "$BT_WF/review.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'over-engineering' "$BT_WF/review.md"
  [ "$status" -eq 0 ]
}

@test "plan script threads graphmind into the planner" {
  for p in 'GRAPHMIND_AVAILABLE' 'mcp__graphmind__gm_search' 'project: "${REPO}"' 'GRAPHMIND_AVAILABLE=true requires a non-empty absolute REPO_PATH'; do
    run rg_or_grep -F "$p" "$WORKFLOWS/build-task-plan.workflow.js"
    [ "$status" -eq 0 ]
  done
}

@test "build-task probes graphmind once and threads it to both workflows" {
  for p in 'select:mcp__graphmind__gm_search' 'graphmind which' 'GRAPHMIND_AVAILABLE, REPO_PATH}'; do
    run rg_or_grep -F "$p" "$SKILL/SKILL.md"
    [ "$status" -eq 0 ]
  done
}

@test "reference docs document GRAPHMIND_AVAILABLE and REPO_PATH for the explore script and the plan script" {
  for f in workflows/explore.md workflows/plan.md; do
    run rg_or_grep -F '`GRAPHMIND_AVAILABLE`' "$SKILL/$f"
    [ "$status" -eq 0 ]
    run rg_or_grep -F '`REPO_PATH`' "$SKILL/$f"
    [ "$status" -eq 0 ]
  done
}

@test "workflows/CLAUDE.md documents the conditional graphmind path and README mentions graphmind" {
  run rg_or_grep -F '## Conditional graphmind path (build-task explorers, delivery planner)' "$WORKFLOWS/CLAUDE.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'graphmindExplorePrompt' "$WORKFLOWS/CLAUDE.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'graphmind which' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
}

@test "taskflow carries no repo-explorer references" {
  # Plain grep -r (not rg_or_grep): that helper passes flags through to rg, where -r means --replace.
  for p in 'repo-explorer' 'EXPLORE_TOOL_AVAILABLE' 'explore_repository'; do
    run grep -rniF "$p" "$PLUGIN"
    [ "$status" -eq 1 ]
  done
}

# --- build-task delivery scripts (plan, implement, review, ship) ---

@test "plan.workflow.js: SIZE-keyed planner model, planner role file, no classifier, status exit contract" {
  F="$WORKFLOWS/build-task-plan.workflow.js"
  [ -s "$F" ]
  for p in 'name: "build-task-plan"' 'decodeArgs(["SPEC_PATH", "PLAN_PATH"]' 'const PLAN_MODEL = { S: "sonnet", M: "opus", L: "opus", XL: "fable" };' 'const plannerModel = (s) => PLAN_MODEL[String(s).toUpperCase()] || "opus";' 'let PLANNER_MODEL = plannerModel(SIZE);' 'model: PLANNER_MODEL' 'planChecker: "sonnet"' 'if (PLANNER_MODEL !== "fable") throw e;' 'PLANNER_MODEL = "opus";' 'if (PLANNER_MODEL === "fable") {' 'planner on fable returned null' 'agentType: "taskflow:planner"' 'planCheckerPrompt = `${NO_NARRATION}' 'GRAPHMIND_AVAILABLE' 'mcp__graphmind__gm_search' 'project: "${REPO}"' 'GRAPHMIND_AVAILABLE=true requires a non-empty absolute REPO_PATH' 'must be an absolute path' 'return { status: "complete", planPath: PLAN_PATH, plannerModel: PLANNER_MODEL };' 'stage: "Plan", error: planned.reason, planPath: PLAN_PATH, plannerModel: PLANNER_MODEL'; do
    run rg_or_grep -F -- "$p" "$F"
    [ "$status" -eq 0 ]
  done
  for absent in 'classify' 'CLASSIFY_SCHEMA' 'difficulty' 'PINNED_OPUS' 'agent definition' 'stage: "done"' 'hardest'; do
    run rg_or_grep -F -- "$absent" "$F"
    [ "$status" -ne 0 ]
  done
}

@test "plan.md documents the plan script contract and the size-to-model table" {
  F="$BT_WF/plan.md"
  [ -s "$F" ]
  for p in 'taskflow:build-task-' 'args global is undefined' 'const args = { … }' "stage: 'args'" '`SPEC_PATH`' '`PLAN_PATH`' '`SIZE`' '`GRAPHMIND_AVAILABLE`' '`REPO_PATH`' '`planPath`' '`plannerModel`' 'fable' 'S sonnet / M opus / L opus / XL fable' 'taskflow:planner' '## Contents' '## Preconditions'; do
    run rg_or_grep -F -- "$p" "$F"
    [ "$status" -eq 0 ]
  done
  for absent in 'claude-opus-4-8' 'spec-driven-delivery' 'design-to-spec'; do
    run rg_or_grep -F -- "$absent" "$F"
    [ "$status" -ne 0 ]
  done
}

@test "implement.workflow.js: plan loader with validation, wave rules, merger role file, heredoc scribe, uniform returns" {
  F="$WORKFLOWS/build-task-implement.workflow.js"
  [ -s "$F" ]
  for p in 'name: "build-task-implement"' 'decodeArgs(["PLAN_PATH", "IMPLEMENT_PATH", "BRANCH_NAME", "SCRATCH_DIR"]' 'must be an absolute path' 'loader: "haiku"' 'merger: "haiku"' 'scribe: "haiku"' 'const implModel = (t) => (t.complexity === "complex" ? "opus" : "haiku");' 'complex: "sonnet"' 'label: "load-plan"' 'label: "load-plan:retry"' 'required: ["constraints", "tasks", "taskHeadings"]' 'p.tasks.length === p.taskHeadings' 'could not load the plan tasks from PLAN_PATH' 'agentType: "taskflow:worktree-merger"' 'protocol, and toplevel self-report per your role definition.' 'testEvidencePath: { type: "string" }' '"testEvidencePath", "deviations"' 'tevPathFor' 'test-evidence-task-' 'named by testEvidencePath' 'isolated ? { isolation: "worktree" } : {}' 'runTask(waveTasks[0], false)' 'runTask(t, true)' 'if (isolated && approved.length)' 'single-task wave: no worktree, no merge step' 'async function persist(path, obj)' 'TASKFLOW_JSON_EOF' 'expectedBytes + 1' 'label: "persist:retry"' 'NEVER the Write or Edit tool' 'could not write IMPLEMENT_PATH — all tasks are committed on ' 'return { status: "complete", implementPath: IMPLEMENT_PATH, tasks: taskList, waves, minorFindings: minorLedger };' 'tasks: [], waves: [], results: [], minorFindings: []'; do
    run rg_or_grep -F -- "$p" "$F"
    [ "$status" -eq 0 ]
  done
  for p in 'implementerPrompt = (t, isolated) =>' 'reviewerPrompt = (t, implReport, isolated) =>' 'fixerPrompt = (t, findings, worktreePath, branch) =>'; do
    followed_by "$p" '`${NO_NARRATION}' "$F"
  done
  run rg_or_grep -iF 'Bash redirection' "$F"
  [ "$status" -eq 0 ]
  for absent in 'classify' 'PINNED_OPUS' 'difficulty' 'agent definition' 'stage: "done"' 'even for wave size 1' 'tasks.length > 4' 'SPEC_PATH' 'BASE_BRANCH' '"worktreePath", "testEvidence", "deviations"' 'testEvidence: { type: "string" }'; do
    run rg_or_grep -F -- "$absent" "$F"
    [ "$status" -ne 0 ]
  done
  # every return after the args check carries tasks, waves and minorFindings
  run bash -c "grep -n 'stage: \"Implement\"' '$F' | grep -vc 'tasks: .*waves.*minorFindings' || true"
  [ "$output" = "0" ]
}

@test "implement.md documents the implement script contract and the wave rules" {
  F="$BT_WF/implement.md"
  [ -s "$F" ]
  for p in 'taskflow:build-task-' 'args global is undefined' 'const args = { … }' "stage: 'args'" '`PLAN_PATH`' '`IMPLEMENT_PATH`' '`BRANCH_NAME`' '`SCRATCH_DIR`' '`implementPath`' '`tasks`' '`waves`' '`minorFindings`' '`results`' 'single-task wave' 'taskflow:worktree-merger' 'taskResults' '## Contents' '## Preconditions'; do
    run rg_or_grep -F -- "$p" "$F"
    [ "$status" -eq 0 ]
  done
  for absent in 'claude-opus-4-8' 'spec-driven-delivery' 'even for single-task waves'; do
    run rg_or_grep -F -- "$absent" "$F"
    [ "$status" -ne 0 ]
  done
}

@test "review.workflow.js: LEVEL arg (never derived), three plugin agents, lean pass, apply, heredoc scribe, returns" {
  F="$WORKFLOWS/build-task-review.workflow.js"
  [ -s "$F" ]
  for p in 'name: "build-task-review"' 'decodeArgs(["SPEC_PATH", "PLAN_PATH", "REVIEW_PATH", "BRANCH_NAME"], { BASE_BRANCH: "main", LEVEL: "high" })' 'if (LEVEL !== "high" && LEVEL !== "max")' 'must be an absolute path' 'phase("Review")' 'phase("Apply")' 'const SWEEP_MAX = 8;' 'const PONYTAIL_MAX = 8;' 'synthesizer: "opus"' 'finder: "sonnet"' 'verifier: "sonnet"' 'applier: "sonnet"' 'ponytailReviewer: "sonnet"' 'scribe: "haiku"' 'r.verdicts || []' 'Array.isArray(r.candidates)' 'Array.isArray(sweep.candidates)' 'PONYTAIL_REVIEW_SCHEMA' 'over-engineering ONLY' 'USER-APPROVED' 'verifyGroups(ponytailCandidates)' 'combinedLocs' 'findings.filter((f) => !f.reversesDecision)' 'async function persist(path, obj)' 'TASKFLOW_JSON_EOF' 'expectedBytes + 1' 'NEVER the Write or Edit tool' 'error: "could not write REVIEW_PATH", level: LEVEL, applied: applyReport, escalatedToUser: escalated, ponytailReview' 'reviewPath: REVIEW_PATH' 'findingCount: findings.length' 'escalatedToUser: escalated'; do
    run rg_or_grep -F -- "$p" "$F"
    [ "$status" -eq 0 ]
  done
  followed_by 'NO_NARRATION' '+ "\n\n' "$F"
  for absent in 'tasks.length > 4' 'classify' 'PINNED_OPUS' 'difficulty' 'stage: "done"' 'phase("Ship")' 'SKILL_DIR.replace' 'role definition' 'pipelineSummary'; do
    run rg_or_grep -F -- "$absent" "$F"
    [ "$status" -ne 0 ]
  done
  # exactly the three plugin review agents, each backed by an agents/*.md file
  run bash -c "grep -oE 'taskflow:[a-z-]+' '$F' | sort -u | tr '\n' ' '"
  [ "$output" = "taskflow:fix-applier taskflow:review-finder taskflow:review-verifier " ]
  for name in review-finder review-verifier fix-applier; do
    [ -f "$AGENTS_DIR/$name.md" ]
  done
  # report-only: the ponytail review is never routed to the fix applier
  run bash -c "grep -n 'ponytail' '$F' | grep -i 'applier' || true"
  [ "$output" = "" ]
  # scope/no-diff errors carry no applied/escalatedToUser keys
  run bash -c "grep -n 'error: \"scope agent returned no result\"\\|error: \"no changes found to review' '$F' | grep -c 'applied\\|escalatedToUser' || true"
  [ "$output" = "0" ]
}

@test "review.md documents the review script contract, LEVEL and the lean review" {
  F="$BT_WF/review.md"
  [ -s "$F" ]
  for p in 'taskflow:build-task-' 'args global is undefined' 'const args = { … }' "stage: 'args'" '`SPEC_PATH`' '`PLAN_PATH`' '`REVIEW_PATH`' '`BRANCH_NAME`' '`BASE_BRANCH`' '`LEVEL`' '`reviewPath`' '`findingCount`' '`applied`' '`escalatedToUser`' 'ponytailReview' 'taskflow:review-finder' 'taskflow:review-verifier' 'taskflow:fix-applier' 'findings.filter((f) => !f.reversesDecision)' '`S`/`M` → `high`, `L`/`XL` → `max`' '## Contents' '## Preconditions'; do
    run rg_or_grep -F -- "$p" "$F"
    [ "$status" -eq 0 ]
  done
  run rg_or_grep -iF 'over-engineering' "$F"
  [ "$status" -eq 0 ]
  for absent in 'claude-opus-4-8' 'spec-driven-delivery' '>4 tasks'; do
    run rg_or_grep -F -- "$absent" "$F"
    [ "$status" -ne 0 ]
  done
}

@test "ship.workflow.js: result-file paths to pr-author, role files, CI loop bounds, reportable ship states" {
  F="$WORKFLOWS/build-task-ship.workflow.js"
  [ -s "$F" ]
  for p in 'name: "build-task-ship"' 'decodeArgs(["SPEC_PATH", "PLAN_PATH", "IMPLEMENT_PATH", "REVIEW_PATH", "PR_BODY_PATH", "BRANCH_NAME"], { BASE_BRANCH: "main", PLUGIN_ROOT: "" })' 'must be an absolute path' 'A.PLUGIN_ROOT.includes("${")' 'prAuthor: "haiku"' 'shipper: "haiku"' 'ciMonitor: "haiku"' 'ciFixer: "sonnet"' 'agentType: "taskflow:pr-author"' 'agentType: "taskflow:shipper"' 'agentType: "taskflow:ci-monitor"' 'agentType: "taskflow:ci-fixer"' 'Pipeline result files (faithful source of truth — Read both): implement result ' '(tasks, waves, per-task minor findings), review result ' '(level, summary, applied/skipped, escalated open items, fix commits, lean-review findings)' 'PR_BODY_PATH' 'bodyPath: { type: "string" }' 'required: ["title", "bodyPath"]' 'mergeState: { enum: ["clean", "rebased", "resolved", "unknown"] }' 'required: ["status"]' 'ship-ensure-mergeable.sh' 'created.mergeState' 'mergeState?' 'rerunId' 'rerunTried' 'const MAX_CI_MONITOR_ROUNDS = 6;' 'const MAX_CI_FIX_ROUNDS = 2;' 'NEVER the Write or Edit tool' 'return { status: "complete", ship };'; do
    run rg_or_grep -F -- "$p" "$F"
    [ "$status" -eq 0 ]
  done
  for absent in 'agent definition' 'per your agent' 'pipelineSummary' 'SCRATCH_DIR' 'if (SHIP)' 'status: "skipped"' 'stage: "done"' 'classify' 'PINNED_OPUS' '<<<BODY' 'stage: "Ship"'; do
    run rg_or_grep -F -- "$absent" "$F"
    [ "$status" -ne 0 ]
  done
  # word-boundary form: a plain -F "prText.body" would substring-match prText.bodyPath
  run rg_or_grep -e 'prText\.body\b' "$F"
  [ "$status" -ne 0 ]
  # four role agents (pr-author, shipper, ci-monitor, ci-fixer), each dispatched through its agentType
  run bash -c "grep -c 'agentType: \"taskflow:' '$F'"
  [ "$output" = "4" ]
}

@test "ship.md documents the ship script contract, mergeState and the stage's hard limits" {
  F="$BT_WF/ship.md"
  [ -s "$F" ]
  for p in 'taskflow:build-task-' 'args global is undefined' 'const args = { … }' "stage: 'args'" '`SPEC_PATH`' '`PLAN_PATH`' '`IMPLEMENT_PATH`' '`REVIEW_PATH`' '`PR_BODY_PATH`' '`BRANCH_NAME`' '`BASE_BRANCH`' '`PLUGIN_ROOT`' '`ship`' 'mergeState?' 'ship-ensure-mergeable' 'taskflow:pr-author' 'taskflow:shipper' 'taskflow:ci-monitor' 'taskflow:ci-fixer' '## Contents' '## Preconditions'; do
    run rg_or_grep -F -- "$p" "$F"
    [ "$status" -eq 0 ]
  done
  run rg_or_grep -iF 'never merges the PR/MR itself' "$F"
  [ "$status" -eq 0 ]
  for absent in 'claude-opus-4-8' 'spec-driven-delivery' '`SHIP`' '`skipped`'; do
    run rg_or_grep -F -- "$absent" "$F"
    [ "$status" -ne 0 ]
  done
}

@test "no delivery script keeps the classifier, the opus pin, the built-in Explore agent or the plan-derived review level" {
  for n in plan implement review ship; do
    for absent in 'classifyPrompt' 'CLASSIFY_SCHEMA' 'label: "classify"' 'agentType: "Explore"' 'difficulty' 'PINNED_OPUS' 'tasks.length > 4'; do
      run rg_or_grep -F -- "$absent" "$WORKFLOWS/build-task-$n.workflow.js"
      [ "$status" -ne 0 ]
    done
  done
  run bash -c "grep -lE 'classify|PINNED_OPUS|tasks.length > 4' '$WORKFLOWS'/build-task-*.workflow.js || true"
  [ "$output" = "" ]
}

@test "build-task SKILL.md step 4 runs plan, implement, review and ship with the documented args and one error rule" {
  F="$SKILL/SKILL.md"
  for p in '{SPEC_PATH, PLAN_PATH, SIZE, GRAPHMIND_AVAILABLE, REPO_PATH, JEV_AVAILABLE}' '{PLAN_PATH, IMPLEMENT_PATH, BRANCH_NAME, SCRATCH_DIR, GRAPHMIND_AVAILABLE, REPO_PATH}' '{SPEC_PATH, PLAN_PATH, REVIEW_PATH, BRANCH_NAME, BASE_BRANCH, LEVEL, GRAPHMIND_AVAILABLE, REPO_PATH}' '{SPEC_PATH, PLAN_PATH, IMPLEMENT_PATH, REVIEW_PATH, PR_BODY_PATH, BRANCH_NAME, BASE_BRANCH, PLUGIN_ROOT, GRAPHMIND_AVAILABLE, REPO_PATH, JEV_AVAILABLE}' '`S` or `M` → `high`, `L` or `XL` → `max`' 'PR/MR skipped at the user' '`SIZE` picks the designer model, the planner model and the review level.' 'taskflow:review-finder' 'taskflow:review-verifier' 'taskflow:fix-applier' 'plannerModel' 'never retry the merge' 'half-implemented plan'; do
    run rg_or_grep -F -- "$p" "$F"
    [ "$status" -eq 0 ]
  done
  # the error rule is stated exactly once
  run bash -c "grep -c 'Review error' '$F'"
  [ "$output" = "1" ]
  run rg_or_grep -F 'Review error that carries' "$F"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'CLAUDE_PLUGIN_ROOT}/workflows' "$F"
  [ "$status" -ne 0 ]
}

@test "build-task ships seven usage references and no role-file directory; the plugin keeps eight workflows" {
  [ ! -e "$SKILL/roles" ]
  run bash -c "ls '$BT_WF'/*.md | wc -l | tr -d '[:space:]'"
  [ "$output" = "7" ]
  run bash -c "ls '$WORKFLOWS'/*.workflow.js | wc -l | tr -d '[:space:]'"
  [ "$output" = "8" ]
}

@test "moved role files: ci-monitor is Bash-only by instruction, pr-author names the result files, planner stays English" {
  run rg_or_grep -F 'never Write, Edit or NotebookEdit, and never a Bash command that changes files or git state.' "$BT_ROLES/ci-monitor.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'tools: ["Bash", "ToolSearch", "mcp__jev-api__choice"]' "$BT_ROLES/ci-monitor.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'the orchestrating workflow re-dispatches you' "$BT_ROLES/ci-monitor.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'names the pipeline result files (implement result, review result) plus the spec and plan paths' "$BT_ROLES/pr-author.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'structured pipeline' "$BT_ROLES/pr-author.md"
  [ "$status" -ne 0 ]
  run rg_or_grep -F 'Write the ENTIRE plan in English' "$BT_ROLES/planner.md"
  [ "$status" -eq 0 ]
  for r in planner worktree-merger pr-author shipper ci-monitor ci-fixer; do
    run rg_or_grep -F 'agent definition' "$BT_ROLES/$r.md"
    [ "$status" -ne 0 ]
  done
}

@test "the three review agents carry no stale spec-driven-delivery reference" {
  for a in review-finder review-verifier fix-applier; do
    run rg_or_grep -F 'spec-driven-delivery' "$AGENTS_DIR/$a.md"
    [ "$status" -ne 0 ]
  done
}

@test "changes-review comments point at the build-task review script, not the removed workflow" {
  F="$WORKFLOWS/changes-review.workflow.js"
  run bash -c "grep -c 'workflows/build-task-review.workflow.js' '$F'"
  [ "$output" = "3" ]
  run rg_or_grep -F 'the NO_NARRATION constant of the build-task scripts' "$F"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'spec-driven-delivery' "$F"
  [ "$status" -ne 0 ]
}

@test "no spec-driven-delivery mention survives in the plugin, root README, marketplace or repo memory files" {
  run grep -rnF 'spec-driven-delivery' "$PLUGIN" "$REPO_ROOT/README.md" "$REPO_ROOT/.claude-plugin" "$REPO_ROOT/.claude/rules" "$REPO_ROOT/plugins/CLAUDE.md" "$REPO_ROOT/CLAUDE.md"
  [ "$status" -eq 1 ]
}

@test "dev notes and README describe the seven build-task scripts, eight role files and the size-driven choices" {
  for p in 'build-task-plan.workflow.js' 'build-task-implement.workflow.js' 'build-task-review.workflow.js' 'build-task-ship.workflow.js' 'implement-<slug>.json' 'review-<slug>.json' 'pr-body-<slug>.md' 'agents/planner.md' 'agents/shipper.md' 'agents/worktree-merger.md' 'carry a `tools` allowlist' 'passed as `LEVEL`' '`plan.md`, `implement.md`, `review.md`, `ship.md`'; do
    run rg_or_grep -F -- "$p" "$PLUGIN/CLAUDE.md"
    [ "$status" -eq 0 ]
  done
  for p in 'plan.workflow.js' 'review.workflow.js' '`S → sonnet`, `M → opus`, `L → opus`, `XL → fable`' '`LEVEL`' 'carries `NO_NARRATION`'; do
    run rg_or_grep -F -- "$p" "$WORKFLOWS/CLAUDE.md"
    [ "$status" -eq 0 ]
  done
  for absent in 'CLASSIFY_SCHEMA' 'simple → sonnet' 'hardest' 'agents/planner.md'; do
    run rg_or_grep -F -- "$absent" "$WORKFLOWS/CLAUDE.md"
    [ "$status" -ne 0 ]
  done
  for p in 'plan.workflow.js' 'implement.workflow.js' 'review.workflow.js' 'ship.workflow.js' 'planner.md' 'ci-fixer.md' 'review-finder.md'; do
    run rg_or_grep -F -- "$p" "$PLUGIN/README.md"
    [ "$status" -eq 0 ]
  done
  run rg_or_grep -F 'references/' "$PLUGIN/README.md"
  [ "$status" -ne 0 ]
  run rg_or_grep -F 'input of the plan script' "$BT_WF/spec.md"
  [ "$status" -eq 0 ]
}

@test "tool hints: scripts append graphmind/jev-api hints only when the skill detected the tool" {
  for n in design implement review ship; do
    run rg_or_grep -F 'const gmHint = (purpose, project) =>' "$WORKFLOWS/build-task-$n.workflow.js"
    [ "$status" -eq 0 ]
    run rg_or_grep -F 'GRAPHMIND_AVAILABLE=true requires a non-empty absolute REPO_PATH' "$WORKFLOWS/build-task-$n.workflow.js"
    [ "$status" -eq 0 ]
  done
  for n in plan ship; do
    run rg_or_grep -F 'A.JEV_AVAILABLE === true' "$WORKFLOWS/build-task-$n.workflow.js"
    [ "$status" -eq 0 ]
  done
  run rg_or_grep -F 'mcp__jev-api__score' "$WORKFLOWS/build-task-plan.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'mcp__jev-api__choice' "$WORKFLOWS/build-task-ship.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'JEV_AVAILABLE = true' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}
