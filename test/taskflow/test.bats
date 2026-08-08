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

@test "plugin.json version is 1.1.0" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" = "1.1.0" ]
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
    # ASCII-only German (no diacritics, e.g. "// wenn ..."): scan comment text
    # only, for common unambiguous German stopwords, word-bounded.
    run bash -c "rg_or_grep -oE '//.*' '$WORKFLOWS/$f' | rg_or_grep -icE '\\b(und|oder|nicht|wird|werden|auch|sowie|sind|eine|einen|kein|keine|wenn|dass|immer|nie|schritt)\\b'"
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

AGENT_NAMES="planner designer design-reviewer review-finder review-verifier worktree-merger fix-applier pr-author shipper ci-monitor ci-fixer cache-probe"

@test "all 12 agent files exist with matching name frontmatter" {
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
  for a in design-reviewer review-finder review-verifier ci-monitor cache-probe; do
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
  run rg_or_grep -F 'Before merging anything' "$AGENTS_DIR/worktree-merger.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'not a worktree' "$AGENTS_DIR/worktree-merger.md"
  [ "$status" -ne 0 ]
}

@test "build-task SKILL.md stays on the current branch when resuming an existing worktree/PR" {
  run rg_or_grep -iF 'existing worktree' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "fix-applier applies and tests fixes per-fix before a single category commit" {
  run rg_or_grep -iF 'PER-FIX' "$AGENTS_DIR/fix-applier.md"
  [ "$status" -eq 0 ]
}

@test "ci-monitor collects a rerunId per failed job; ci-fixer consumes it" {
  run rg_or_grep -F 'rerunId' "$AGENTS_DIR/ci-monitor.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'rerunId' "$AGENTS_DIR/ci-fixer.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'rerunId' "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
}

@test "design-to-spec workflow retries the spec reviewer once and reports specReviewed" {
  run rg_or_grep -F 'function reviewSpec' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'specReviewed' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
}

@test "design-to-spec workflow caches Explore results per session" {
  for pat in EXPLORE_CACHE_PATH FINGERPRINT_CMD 'explore-cache:probe' 'explore-cache:write' MAX_TOTAL_EXPLORE_AREAS; do
    run rg_or_grep -F "$pat" "$WORKFLOWS/design-to-spec.workflow.js"
    [ "$status" -eq 0 ]
  done
}

@test "the Explore cache is keyed on the task and validated before reuse" {
  run rg_or_grep -F 'function taskKey' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'cacheHit' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'declaredLines === probe.actualLines' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
}

@test "an invalidated Explore cache contributes no area names" {
  run rg_or_grep -F 'const cachedAreas = cacheHit ? parsedAreas : [];' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
}

@test "the Explore cache introduces no new required arg" {
  run rg_or_grep -F 'decodeArgs(["TASK", "DRAFT_PATH", "SPEC_PATH"]' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
}

@test "the scout's proposed subsystems are deduped before the budget slice" {
  run rg_or_grep -F 'seenProposedNames' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
}

@test "the Explore-cache probe is dispatched with a Bash+Read-only agentType" {
  run rg_or_grep -F 'agentType: AGENTS.cacheProbe' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
  [ -f "$AGENTS_DIR/cache-probe.md" ]
  run rg_or_grep -F 'tools: ["Bash", "Read"]' "$AGENTS_DIR/cache-probe.md"
  [ "$status" -eq 0 ]
}

@test "the Explore-cache write runs concurrently with the first designer call" {
  run rg_or_grep -F 'parallel([cacheWriteThunk,' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
}

@test "the Explore-cache write is serialized instead when the designer would read the same file" {
  run rg_or_grep -F 'needsSerialWrite = cacheHit && exploration' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
}

@test "the Explore-cache writer reuses an already-computed fingerprint and gets one scripted retry" {
  run rg_or_grep -F 'function writeCache' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'writeCache(mode, totalLines, areaLine, currentFingerprint)' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
}

@test "the Explore-cache writer's scripted retry excludes the non-idempotent append mode" {
  run rg_or_grep -F 'mode === "create"' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
}

@test "design-to-spec reference documents the Explore cache" {
  run rg_or_grep -F 'explore-' "$REFS/design-to-spec.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'cache' "$REFS/design-to-spec.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '.explore-' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "spec-driven-delivery workflow guards agent array fields before iterating" {
  run rg_or_grep -F 'r.verdicts || []' "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'Array.isArray(r.candidates)' "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'Array.isArray(sweep.candidates)' "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
}
