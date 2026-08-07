#!/usr/bin/env bats
# Structural suite for the taskflow plugin. Hermetic: no network, no execution
# of the Workflow-tool scripts (they run only inside the Workflow tool's own
# runtime) — everything here is manifest/frontmatter/shape assertions.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/taskflow"
  SKILL="$PLUGIN/skills/build-task"
  REFS="$SKILL/references"
  AGENTS_DIR="$PLUGIN/agents"
  WORKFLOWS="$PLUGIN/workflows"
  MARKET="$REPO_ROOT/.claude-plugin/marketplace.json"
  ESLINT_CONFIG="$REPO_ROOT/eslint.config.mjs"
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

# --- Manifest invariants ---

@test "plugin.json is valid and has required fields, no userConfig (deliberate — see CLAUDE.md)" {
  run jq -e '.name == "taskflow" and (.version | type == "string") and (.description | length > 0) and (has("userConfig") | not)' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
}

@test "plugin.json version is 1.0.0" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" = "1.0.0" ]
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

@test "build-task SKILL.md references both workflow reference files" {
  run rg_or_grep -F 'references/design-to-spec.md' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'references/spec-driven-delivery.md' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "both workflow reference files exist and are non-empty" {
  [ -s "$REFS/design-to-spec.md" ]
  [ -s "$REFS/spec-driven-delivery.md" ]
}

# --- workflows/ ---

@test "both workflow scripts exist and declare export const meta" {
  for f in design-to-spec.workflow.js spec-driven-delivery.workflow.js; do
    [ -s "$WORKFLOWS/$f" ]
    run rg_or_grep -F 'export const meta = {' "$WORKFLOWS/$f"
    [ "$status" -eq 0 ]
  done
}

@test "workflow meta names match their filenames" {
  run rg_or_grep -E "name:[[:space:]]*[\"']design-to-spec[\"']" "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -E "name:[[:space:]]*[\"']spec-driven-delivery[\"']" "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
}

@test "workflow scripts guard args via a decodeArgs fail-fast" {
  for f in design-to-spec.workflow.js spec-driven-delivery.workflow.js; do
    run rg_or_grep -F 'function decodeArgs' "$WORKFLOWS/$f"
    [ "$status" -eq 0 ]
    run rg_or_grep -E "stage:[[:space:]]*[\"']args[\"']" "$WORKFLOWS/$f"
    [ "$status" -eq 0 ]
  done
}

@test "workflow scripts contain no leftover German comments" {
  for f in design-to-spec.workflow.js spec-driven-delivery.workflow.js; do
    run rg_or_grep -cE '[äöüßÄÖÜ]' "$WORKFLOWS/$f"
    [ "$status" -ne 0 ] || [ "$output" -eq 0 ]
  done
}

@test "every agentType referenced by the workflows has a matching agents/*.md file" {
  for f in design-to-spec.workflow.js spec-driven-delivery.workflow.js; do
    for name in $(rg_or_grep -oE "taskflow:[a-z-]+" "$WORKFLOWS/$f" | sed 's/taskflow://' | sort -u); do
      [ -f "$AGENTS_DIR/$name.md" ]
    done
  done
}

@test "eslint.config.mjs ignores *.workflow.js (top-level await/return, not a standalone module)" {
  run rg_or_grep -F '*.workflow.js' "$ESLINT_CONFIG"
  [ "$status" -eq 0 ]
}

@test "designer and planner agents require English output regardless of input language" {
  run rg_or_grep -iF 'English' "$AGENTS_DIR/designer.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'English' "$AGENTS_DIR/planner.md"
  [ "$status" -eq 0 ]
}

@test "the inline spec-writer prompt requires English output regardless of the draft's language" {
  run rg_or_grep -iF 'English' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
}

# --- agents ---

AGENT_NAMES="planner designer design-reviewer review-finder review-verifier worktree-merger fix-applier pr-author shipper ci-monitor ci-fixer"

@test "all 11 agent files exist with matching name frontmatter" {
  for a in $AGENT_NAMES; do
    [ -f "$AGENTS_DIR/$a.md" ]
    run rg_or_grep -E "^name:[[:space:]]*$a\$" "$AGENTS_DIR/$a.md"
    [ "$status" -eq 0 ]
  done
}

@test "all agent files declare a model" {
  for a in $AGENT_NAMES; do
    run rg_or_grep -E '^model:' "$AGENTS_DIR/$a.md"
    [ "$status" -eq 0 ]
  done
}

@test "all agent files are marked INTERNAL, not for direct delegation" {
  for a in $AGENT_NAMES; do
    run rg_or_grep -F 'INTERNAL' "$AGENTS_DIR/$a.md"
    [ "$status" -eq 0 ]
  done
}

@test "read-only-declared agents carry a least-privilege tools allowlist without Write/Edit" {
  for a in design-reviewer review-finder review-verifier ci-monitor; do
    run rg_or_grep -E '^tools:' "$AGENTS_DIR/$a.md"
    [ "$status" -eq 0 ]
    run rg_or_grep -E '^tools:.*"(Write|Edit)"' "$AGENTS_DIR/$a.md"
    [ "$status" -ne 0 ]
  done
}
