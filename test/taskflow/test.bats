#!/usr/bin/env bats
# Structural suite for the taskflow plugin. Hermetic: no network, no execution
# of the Workflow-tool scripts (they run only inside the Workflow tool's own
# runtime) — everything here is manifest/frontmatter/shape assertions.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/taskflow"
  SKILL="$PLUGIN/skills/build-task"
  DISPATCH="$PLUGIN/skills/dispatch-task"
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

@test "plugin.json version is 1.3.0" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" = "1.3.0" ]
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

@test "both workflow scripts forbid narrative text in every inline (non-agentType) prompt" {
  run rg_or_grep -F 'const NO_NARRATION' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'const NO_NARRATION' "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
  for p in 'scoutPrompt = `${NO_NARRATION}' '`${NO_NARRATION}\n\nYou are a read-only codebase explorer' 'specWriterPrompt = (revision) => `${NO_NARRATION}' 'specReviewerPrompt = `${NO_NARRATION}'; do
    run rg_or_grep -F "$p" "$WORKFLOWS/design-to-spec.workflow.js"
    [ "$status" -eq 0 ]
  done
  for p in 'planCheckerPrompt = `${NO_NARRATION}' 'implementerPrompt = (t) => `${NO_NARRATION}' 'reviewerPrompt = (t, implReport) => `${NO_NARRATION}' 'fixerPrompt = (t, findings, worktreePath, branch) => `${NO_NARRATION}' 'NO_NARRATION +'; do
    run rg_or_grep -F "$p" "$WORKFLOWS/spec-driven-delivery.workflow.js"
    [ "$status" -eq 0 ]
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

@test "all agent files declare a model; only designer and planner carry the Opus pin" {
  for a in $AGENT_NAMES; do
    run rg_or_grep -E '^model:' "$AGENTS_DIR/$a.md"
    [ "$status" -eq 0 ]
    case "$a" in
      designer | planner)
        run rg_or_grep -E '^model: claude-opus-4-8$' "$AGENTS_DIR/$a.md"
        ;;
      *)
        run rg_or_grep -E '^model: (sonnet|haiku)$' "$AGENTS_DIR/$a.md"
        ;;
    esac
    [ "$status" -eq 0 ]
  done
}

@test "all agent files are marked INTERNAL, not for direct delegation" {
  for a in $AGENT_NAMES; do
    run rg_or_grep -F 'INTERNAL' "$AGENTS_DIR/$a.md"
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
  for a in design-reviewer review-finder review-verifier ci-monitor; do
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

@test "the scout's proposed subsystems are deduped before the budget slice" {
  run rg_or_grep -F 'seenProposedNames' "$WORKFLOWS/design-to-spec.workflow.js"
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

# --- Model assignment: Opus-tier pin (see plugins/taskflow/CLAUDE.md) ---

@test "designer, planner, synthesizer and the complex impl tier are pinned to claude-opus-4-8" {
  run rg_or_grep -F 'designer: "claude-opus-4-8"' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'const PINNED_OPUS = "claude-opus-4-8"' "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'planner: PINNED_OPUS' "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'synthesizer: PINNED_OPUS' "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'complex: PINNED_OPUS' "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
}

@test "both workflow scripts' comment blocks name the pinned model ID" {
  run rg_or_grep -F 'claude-opus-4-8' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'claude-opus-4-8' "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
}

@test "sonnet and haiku workflow assignments stay bare aliases" {
  run rg_or_grep -F 'explorer: "sonnet"' "$WORKFLOWS/design-to-spec.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'merger: "haiku"' "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'trivial: "haiku", standard: "sonnet"' "$WORKFLOWS/spec-driven-delivery.workflow.js"
  [ "$status" -eq 0 ]
}

@test "CLAUDE.md's Model assignment section records the Opus pin as a dated exception and keeps aliases as the rule" {
  section="$BATS_TEST_TMPDIR/model-assignment.md"
  awk '/^## Model assignment$/{f=1;next} /^## /{f=0} f' "$PLUGIN/CLAUDE.md" > "$section"
  [ -s "$section" ]
  run rg_or_grep -F 'claude-opus-4-8' "$section"
  [ "$status" -eq 0 ]
  run rg_or_grep -iF 'exception' "$section"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '2026-08-12' "$section"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '`sonnet`/`haiku`' "$section"
  [ "$status" -eq 0 ]
}

@test "README Agents table and both workflow references quote the pinned model ID, not the opus alias" {
  run rg_or_grep -F 'claude-opus-4-8' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'claude-opus-4-8' "$REFS/design-to-spec.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'claude-opus-4-8' "$REFS/spec-driven-delivery.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '`opus` alias' "$REFS/design-to-spec.md"
  [ "$status" -ne 0 ]
  run rg_or_grep -F '`opus` alias' "$REFS/spec-driven-delivery.md"
  [ "$status" -ne 0 ]
}

@test "no bare opus alias survives anywhere in the plugin outside CLAUDE.md's exception prose" {
  # Plain grep: --exclude has no rg_or_grep equivalent. Match only a standalone
  # `opus` token (not part of a hyphenated model ID like `claude-opus-4-8`) —
  # filtering out whole lines that merely CONTAIN `claude-opus-4-8` would also
  # hide a bare `opus` alias coexisting on that same line (CodeRabbit finding,
  # PR #193).
  run bash -c "grep -rnE '(^|[^[:alnum:]_-])opus([^[:alnum:]_-]|\$)' '$PLUGIN' --exclude=CLAUDE.md || true"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
  # CLAUDE.md keeps exactly the exception prose that names the alias.
  run bash -c "grep -cw 'opus' '$PLUGIN/CLAUDE.md'"
  [ "$status" -eq 0 ]
  [ "$output" -ge 2 ]
}

# --- dispatch-task skill ---

@test "dispatch-task SKILL.md exists and is non-empty" {
  [ -s "$DISPATCH/SKILL.md" ]
}

@test "dispatch-task frontmatter declares name, arguments and the minimal allowed-tools" {
  fm="$BATS_TEST_TMPDIR/dispatch-task-frontmatter.txt"
  sed -n '/^---$/,/^---$/p' "$DISPATCH/SKILL.md" > "$fm"
  [ -s "$fm" ]
  for pat in 'name: dispatch-task' 'arguments: task_description' '"Bash(claude:*)"' '"AskUserQuestion"'; do
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

@test "dispatch-task skill dir is self-contained (no cross-plugin references)" {
  run bash -c "grep -riE 'coding-toolbox|dispatch-agent|superpowers|branch-management' '$DISPATCH'"
  [ "$status" -eq 1 ]
}

@test "dispatch-task dispatches a background worktree session on fixed sonnet/medium with permission-mode auto" {
  for pat in 'claude --worktree' '--bg' '--model "sonnet"' '--effort "medium"' '--permission-mode auto'; do
    run rg_or_grep -F -- "$pat" "$DISPATCH/SKILL.md"
    [ "$status" -eq 0 ]
  done
}

@test "dispatch-task and CLAUDE.md document worktree.baseRef instead of assuming the default branch unconditionally" {
  run rg_or_grep -F 'worktree.baseRef' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '"head"' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'worktree.baseRef' "$PLUGIN/CLAUDE.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F '"head"' "$PLUGIN/CLAUDE.md"
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

@test "dispatch-task picks a fresh heredoc delimiter per invocation, not the old fixed literal" {
  run rg_or_grep -iF 'never reuse a fixed literal' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E "<<[[:space:]]?'DISPATCH_TASK_PROMPT_EOF'" "$DISPATCH/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "dispatch-task cuts a properly named feature/<slug> branch before invoking build-task" {
  run rg_or_grep -F 'git checkout -b' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'feature/<' "$DISPATCH/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "plugin README lists dispatch-task in the Skills section" {
  run rg_or_grep -F '| `dispatch-task`' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
}
