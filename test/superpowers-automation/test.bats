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
  run grep -q "context: fork" "$f"
  assert_success
  run grep -q "model: claude-sonnet-4-6" "$f"
  assert_success
  run grep -q "arguments: file_path" "$f"
  assert_success
  # unlocked: no disable-model-invocation
  run grep -q "disable-model-invocation" "$f"
  assert_failure
}

@test "file-advisor-improver skill grants Edit and Write" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/file-advisor-improver/SKILL.md"
  run grep -Eq 'allowed-tools:.*Edit' "$f"
  assert_success
  run grep -Eq 'allowed-tools:.*Write' "$f"
  assert_success
}

@test "file-advisor-improver skill defines the file-gate and advisor-gate warnings" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/file-advisor-improver/SKILL.md"
  run grep -q "WARNING: file-advisor-improver: no readable file to review — skipped" "$f"
  assert_success
  run grep -q "WARNING: file-advisor-improver: advisor tool unavailable — skipped" "$f"
  assert_success
}

@test "file-advisor-improver skill signals on-disk change for re-read" {
  local f="$REPO_ROOT/plugins/superpowers-automation/skills/file-advisor-improver/SKILL.md"
  run grep -q "FILE UPDATED ON DISK:" "$f"
  assert_success
  run grep -q "re-read before further edits" "$f"
  assert_success
}

