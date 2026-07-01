#!/usr/bin/env bats

# Tests for the coding-toolbox plugin (golden behavior rules hooks).

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/coding-toolbox"
  HOOKS="$PLUGIN/hooks"
}

@test "plugin.json is valid JSON with name/version/description" {
  run jq -e '.name == "coding-toolbox" and (.version | type == "string") and (.description | length > 0)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin is registered in marketplace.json" {
  run jq -e '[.plugins[] | select(.name == "coding-toolbox" and .source == "./plugins/coding-toolbox")] | length == 1' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "marketplace.json entry carries no version field" {
  run jq -e '[.plugins[] | select(.name == "coding-toolbox") | has("version")] | any | not' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "plugin has a root README table row" {
  run grep -F "[coding-toolbox](plugins/coding-toolbox/README.md)" "$REPO_ROOT/README.md"
  assert_success
}

@test "plugin is in the test.yml matrix" {
  run grep -E "^\s*-\s*coding-toolbox\s*$" "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}

@test "SessionStart.md exists and is non-empty" {
  run test -s "$HOOKS/SessionStart.md"
  assert_success
}

@test "SessionStart.md covers all four axes and cites all three sourced axes" {
  run cat "$HOOKS/SessionStart.md"
  assert_success
  assert_output --partial "Interaction"
  assert_output --partial "AskUserQuestion"
  assert_output --partial "Language"
  assert_output --partial "Behavior"
  assert_output --partial "Mentality"
  assert_output --partial "cavemem"
  assert_output --partial "andrej-karpathy-skills"
  assert_output --partial "ponytail-lite"
}

# Anti-flip tripwire: PreToolUse.json is a valid PreToolUse payload with a non-empty
# additionalContext and NO permissionDecision (which would interfere with the permission flow).
@test "PreToolUse.json is a valid PreToolUse additionalContext payload" {
  run jq -e '.hookSpecificOutput.hookEventName == "PreToolUse" and (.hookSpecificOutput.additionalContext | length > 0) and (.hookSpecificOutput | has("permissionDecision") | not)' "$HOOKS/PreToolUse.json"
  assert_success
}

@test "PreToolUse.json mentions AskUserQuestion" {
  run cat "$HOOKS/PreToolUse.json"
  assert_success
  assert_output --partial "AskUserQuestion"
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS/hooks.json"
  assert_success
}

@test "SessionStart hook cats SessionStart.md via a command hook (exec form)" {
  run jq -e '.hooks.SessionStart[0].hooks[0] | .type == "command" and .command == "cat" and (.args[0] | endswith("/hooks/SessionStart.md"))' "$HOOKS/hooks.json"
  assert_success
}

# Runtime/end-to-end test: run the wired SessionStart command+args and confirm it
# emits the rules (catches a wrong args path; proves cat+args does not read stdin).
@test "SessionStart hook command emits Golden Rules to stdout (end-to-end)" {
  cmd="$(jq -r '.hooks.SessionStart[0].hooks[0].command' "$HOOKS/hooks.json")"
  arg="$(jq -r '.hooks.SessionStart[0].hooks[0].args[0]' "$HOOKS/hooks.json" | sed "s#\${CLAUDE_PLUGIN_ROOT}#$PLUGIN#")"
  run "$cmd" "$arg"
  assert_success
  assert_output --partial "Golden Rules"
}

@test "PreToolUse hook is matcher-scoped and cats PreToolUse.json (exec form)" {
  run jq -e '.hooks.PreToolUse[0] | .matcher == "Edit|Write|NotebookEdit|Bash|Task|Agent" and (.hooks[0].type == "command") and (.hooks[0].command == "cat") and (.hooks[0].args[0] | endswith("/hooks/PreToolUse.json"))' "$HOOKS/hooks.json"
  assert_success
}

# Anti-flip tripwire (end-to-end): the wired PreToolUse command emits valid
# additionalContext JSON and NO permissionDecision. `cat`ing the JSON file IS the output.
@test "PreToolUse hook command emits valid additionalContext JSON (end-to-end)" {
  cmd="$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$HOOKS/hooks.json")"
  arg="$(jq -r '.hooks.PreToolUse[0].hooks[0].args[0]' "$HOOKS/hooks.json" | sed "s#\${CLAUDE_PLUGIN_ROOT}#$PLUGIN#")"
  run bash -c "'$cmd' '$arg' | jq -e '.hookSpecificOutput.hookEventName == \"PreToolUse\" and (.hookSpecificOutput.additionalContext | length > 0) and (.hookSpecificOutput | has(\"permissionDecision\") | not)'"
  assert_success
}

@test "plugin README first ## heading is Install" {
  run bash -c "grep -m1 '^## ' '$PLUGIN/README.md'"
  assert_success
  assert_output "## Install"
}

@test "plugin README contains the install command" {
  run grep -F "/plugin install coding-toolbox@kwitsch-plugins" "$PLUGIN/README.md"
  assert_success
}

@test "plugin README has no ## Hooks section" {
  run grep -E "^## Hooks" "$PLUGIN/README.md"
  assert_failure
}
