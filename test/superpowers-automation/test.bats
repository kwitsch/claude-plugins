#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
bats_load_library bats-support
bats_load_library bats-assert

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/plugins/superpowers-automation/hooks/post-write.mjs"
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude"
}

write_settings() {
  local hook_plans="${1:-false}"
  cat > "$HOME/.claude/settings.json" <<EOF
{
  "pluginConfigs": {
    "superpowers-automation@kwitsch-plugins": {
      "options": {
        "hook_plans": $hook_plans
      }
    }
  }
}
EOF
}

run_hook() {
  printf '{"tool_input":{"file_path":"%s"}}' "$1" | "$HOOK"
}

# Prefer ripgrep; fall back to grep if rg isn't installed. rg's -E means
# --encoding=ARG and -r means --replace=ARG (both take a value, neither is
# grep's meaning), and rg has no recursive flag (recursion is its
# default) — so a bundled/bare -E is stripped before delegating to rg
# (its regex syntax is already ERE-equivalent for every pattern used in
# this file); grep gets its original arguments completely untouched.
# Note: bare `rg -c` prints nothing on 0 matches where `grep -c` prints `0`
# (both exit 1) -- no call site here checks that text (only $status or a
# nonzero count), so this divergence is accepted rather than papered over
# with --include-zero, which errors on ripgrep < 12.0.0.
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

@test "plans hook: instructs subagent-driven-development with path when hook_plans=true" {
  write_settings true
  run run_hook "docs/superpowers/plans/2026-06-10-foo.md"
  assert_success
  assert_output --partial "superpowers:subagent-driven-development"
  assert_output --partial "docs/superpowers/plans/2026-06-10-foo.md"
}

@test "plans hook: silent when hook_plans=false" {
  write_settings false
  run run_hook "docs/superpowers/plans/2026-06-10-foo.md"
  assert_success
  assert_output ""
}

@test "spec path: silent (spec hook removed) even when hook_plans=true" {
  write_settings true
  run run_hook "docs/superpowers/specs/2026-06-10-bar.md"
  assert_success
  assert_output ""
}

@test "non-matching path: silent when hook_plans=true" {
  write_settings true
  run run_hook "src/some/file.ts"
  assert_success
  assert_output ""
}

@test "plans hook: matches absolute path from Claude Code" {
  write_settings true
  run run_hook "/home/user/project/docs/superpowers/plans/2026-06-10-foo.md"
  assert_success
  assert_output --partial "superpowers:subagent-driven-development"
}

@test "missing settings file: silent" {
  run run_hook "docs/superpowers/plans/2026-06-10-foo.md"
  assert_success
  assert_output ""
}

@test "output is valid JSON with hookSpecificOutput" {
  write_settings true
  local hook_output
  hook_output="$(run_hook "docs/superpowers/plans/2026-06-10-foo.md")"
  [ -n "$hook_output" ] || fail "hook produced no output"
  run jq -e '.hookSpecificOutput.hookEventName' <<< "$hook_output"
  assert_success
  assert_output '"PostToolUse"'
  run jq -e '(.hookSpecificOutput.additionalContext | type) == "string" and (.hookSpecificOutput.additionalContext | length) > 0' <<< "$hook_output"
  assert_success
  assert_output 'true'
}

@test "post-write.mjs is executable" {
  run test -x "$REPO_ROOT/plugins/superpowers-automation/hooks/post-write.mjs"
  assert_success
}

@test "plugin.json is valid JSON with required fields" {
  run jq -e '.name and .version and (.userConfig | type == "object")' \
    "$REPO_ROOT/plugins/superpowers-automation/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin.json userConfig defaults are false" {
  run jq -e '.userConfig.hook_plans.default == false' \
    "$REPO_ROOT/plugins/superpowers-automation/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin.json userConfig declares exactly the expected keys" {
  run jq -r '.userConfig | keys | sort | join(" ")' \
    "$REPO_ROOT/plugins/superpowers-automation/.claude-plugin/plugin.json"
  assert_success
  assert_output "hook_plans"
}

@test "plugin.json declares superpowers dependency" {
  run jq -e '
    (.dependencies | type == "array") and
    (any(.dependencies[]; .name == "superpowers" and .marketplace == "claude-plugins-official"))
  ' "$REPO_ROOT/plugins/superpowers-automation/.claude-plugin/plugin.json"
  assert_success
}

@test "spec-advisor-review skill is removed" {
  run test -e "$REPO_ROOT/plugins/superpowers-automation/skills/spec-advisor-review"
  assert_failure
}

@test "plan-advisor-review skill is removed" {
  run test -e "$REPO_ROOT/plugins/superpowers-automation/skills/plan-advisor-review"
  assert_failure
}

@test "file-advisor-improver skill declares fork + sonnet + args, and is unlocked" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/file-advisor-improver/SKILL.md"
  run test -f "$f"
  assert_success
  run rg_or_grep -q "context: fork" "$f"
  assert_success
  run rg_or_grep -q "model: claude-sonnet-4-6" "$f"
  assert_success
  run rg_or_grep -q "arguments: file_path" "$f"
  assert_success
  # unlocked: no disable-model-invocation
  run rg_or_grep -q "disable-model-invocation" "$f"
  assert_failure
}

@test "file-advisor-improver skill grants Edit and Write" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/file-advisor-improver/SKILL.md"
  run rg_or_grep -Eq 'allowed-tools:.*Edit' "$f"
  assert_success
  run rg_or_grep -Eq 'allowed-tools:.*Write' "$f"
  assert_success
}

@test "file-advisor-improver skill defines the file-gate and advisor-gate warnings" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/file-advisor-improver/SKILL.md"
  run rg_or_grep -q "WARNING: file-advisor-improver: no readable file to review — skipped" "$f"
  assert_success
  run rg_or_grep -q "WARNING: file-advisor-improver: advisor tool unavailable — skipped" "$f"
  assert_success
}

@test "file-advisor-improver skill signals on-disk change for re-read" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/file-advisor-improver/SKILL.md"
  run rg_or_grep -q "FILE UPDATED ON DISK:" "$f"
  assert_success
  run rg_or_grep -q "re-read before further edits" "$f"
  assert_success
}

@test "new-work skill exists with frontmatter" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/new-work/SKILL.md"
  run test -f "$f"
  assert_success
  run rg_or_grep -q "name: new-work" "$f"
  assert_success
  run rg_or_grep -q "argument-hint:" "$f"
  assert_success
}

@test "new-work skill is model+user invocable and not forked" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/new-work/SKILL.md"
  run rg_or_grep -q "disable-model-invocation" "$f"
  assert_failure
  run rg_or_grep -q "context: fork" "$f"
  assert_failure
}

@test "new-work skill names the pipeline sub-skills and branch step" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/new-work/SKILL.md"
  run rg_or_grep -q "superpowers:brainstorming" "$f"
  assert_success
  run rg_or_grep -q "superpowers:systematic-debugging" "$f"
  assert_success
  run rg_or_grep -q "superpowers-automation:file-advisor-improver" "$f"
  assert_success
  run rg_or_grep -q "superpowers:writing-plans" "$f"
  assert_success
  run rg_or_grep -q "superpowers:subagent-driven-development" "$f"
  assert_success
  run rg_or_grep -q "branch-management:new-branch" "$f"
  assert_success
}

@test "new-work skill classifies work into feature/fix/refactor branch prefixes" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/new-work/SKILL.md"
  run rg_or_grep -q "feature/" "$f"
  assert_success
  run rg_or_grep -q "fix/" "$f"
  assert_success
  run rg_or_grep -q "refactor/" "$f"
  assert_success
}

@test "new-work skill documents step-numbered task-list integration" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/new-work/SKILL.md"
  run rg_or_grep -q "Task-list integration" "$f"
  assert_success
  run rg_or_grep -qE "Step N\.1" "$f"
  assert_success
}

@test "new-work skill mandates per-step task tracking via Task tools (TaskCreate/TaskUpdate)" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/new-work/SKILL.md"
  run rg_or_grep -q "TaskCreate" "$f"
  assert_success
  run rg_or_grep -q "TaskUpdate" "$f"
  assert_success
  run rg_or_grep -q "in_progress" "$f"
  assert_success
  run rg_or_grep -q "completed" "$f"
  assert_success
}
