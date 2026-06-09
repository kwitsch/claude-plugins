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
  local hook_specs="${2:-false}"
  cat > "$HOME/.claude/settings.json" <<EOF
{
  "pluginConfigs": {
    "superpowers-automation@kwitsch-plugins": {
      "options": {
        "hook_plans": $hook_plans,
        "hook_specs": $hook_specs
      }
    }
  }
}
EOF
}

run_hook() {
  printf '{"tool_input":{"file_path":"%s"}}' "$1" | "$HOOK"
}

@test "plans hook: emits context when hook_plans=true" {
  write_settings true false
  run run_hook "docs/superpowers/plans/2026-06-10-foo.md"
  assert_success
  assert_output --partial "Subagent-Driven"
}

@test "specs hook: emits context when hook_specs=true" {
  write_settings false true
  run run_hook "docs/superpowers/specs/2026-06-10-bar.md"
  assert_success
  assert_output --partial "Proceed after self-review"
}

@test "plans hook: silent when hook_plans=false" {
  write_settings false false
  run run_hook "docs/superpowers/plans/2026-06-10-foo.md"
  assert_success
  assert_output ""
}

@test "specs hook: silent when hook_specs=false" {
  write_settings false false
  run run_hook "docs/superpowers/specs/2026-06-10-bar.md"
  assert_success
  assert_output ""
}

@test "non-matching path: silent even when both enabled" {
  write_settings true true
  run run_hook "src/some/file.ts"
  assert_success
  assert_output ""
}

@test "plans hook: silent when hook_plans=false even with hook_specs=true" {
  write_settings false true
  run run_hook "docs/superpowers/plans/2026-06-10-foo.md"
  assert_success
  assert_output ""
}

@test "specs hook: silent when hook_specs=false even with hook_plans=true" {
  write_settings true false
  run run_hook "docs/superpowers/specs/2026-06-10-bar.md"
  assert_success
  assert_output ""
}

@test "missing settings file: silent" {
  run run_hook "docs/superpowers/plans/2026-06-10-foo.md"
  assert_success
  assert_output ""
}

@test "output is valid JSON with hookSpecificOutput" {
  write_settings true false
  local hook_output
  hook_output="$(run_hook "docs/superpowers/plans/2026-06-10-foo.md")"
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
  run jq -e '
    .userConfig.hook_plans.default == false and
    .userConfig.hook_specs.default == false
  ' "$REPO_ROOT/plugins/superpowers-automation/.claude-plugin/plugin.json"
  assert_success
}
