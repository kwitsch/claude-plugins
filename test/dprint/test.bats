#!/usr/bin/env bats

load 'test_helper'

setup() {
  common_setup
  MARKET="$REPO_ROOT/.claude-plugin/marketplace.json"
}

@test "plugin.json is valid, pins version 0.1.0, and has required fields" {
  run jq -e '.name == "dprint" and .version == "0.1.0" and (.description | length > 0) and (.author.name == "Kwitsch")' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin.json carries no userConfig" {
  run jq -e 'has("userConfig") | not' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "marketplace.json has exactly one dprint entry with the right source and no version" {
  run jq -e '[.plugins[] | select(.name == "dprint" and .source == "./plugins/dprint")] | length == 1' "$MARKET"
  assert_success
  run jq -e '[.plugins[] | select(.name == "dprint") | has("version")] | any | not' "$MARKET"
  assert_success
}

@test "marketplace.json dprint entry has author Kwitsch and category development" {
  run jq -e '.plugins[] | select(.name == "dprint") | .author.name == "Kwitsch" and .category == "development"' "$MARKET"
  assert_success
}

@test "marketplace.json dprint description is byte-identical to plugin.json" {
  plugin_desc="$(jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json")"
  market_desc="$(jq -r '.plugins[] | select(.name == "dprint") | .description' "$MARKET")"
  [ "$plugin_desc" = "$market_desc" ]
}

@test "root README links the dprint plugin README" {
  run grep -F '[dprint](plugins/dprint/README.md)' "$REPO_ROOT/README.md"
  assert_success
}

@test "CI test matrix lists dprint" {
  run grep -n -- '- dprint$' "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}

@test "plugin README has Install first with the install command" {
  run grep -m1 '^## ' "$PLUGIN/README.md"
  assert_output "## Install"
  run grep -F '/plugin install dprint@kwitsch-plugins' "$PLUGIN/README.md"
  assert_success
}

@test "SKILL.md exists with name init-dprint and a description" {
  [ -f "$SKILL_DIR/SKILL.md" ]
  run grep -Fx 'name: init-dprint' "$SKILL_DIR/SKILL.md"
  assert_success
  run grep -E '^description: .+' "$SKILL_DIR/SKILL.md"
  assert_success
}

@test "SKILL.md allowed-tools is exactly AskUserQuestion + Bash(node:*), never bare Bash" {
  run grep -Fx 'allowed-tools: ["AskUserQuestion", "Bash(node:*)"]' "$SKILL_DIR/SKILL.md"
  assert_success
  run grep -F '"Bash"' "$SKILL_DIR/SKILL.md"
  assert_failure
}

@test "SKILL.md is model-invocable (no disable-model-invocation)" {
  run grep -F 'disable-model-invocation' "$SKILL_DIR/SKILL.md"
  assert_failure
}

@test "SKILL.md invokes the script via the literal CLAUDE_SKILL_DIR token and reads its reference" {
  run grep -F 'node ${CLAUDE_SKILL_DIR}/check-dprint.mjs' "$SKILL_DIR/SKILL.md"
  assert_success
  run grep -F 'check-dprint.reference.md' "$SKILL_DIR/SKILL.md"
  assert_success
}

@test "SKILL.md never contains the exclamation-backtick injection sequence" {
  run grep -cF '!`' "$SKILL_DIR/SKILL.md"
  assert_output "0"
}

@test "SKILL.md gates install/update behind AskUserQuestion Install/Update/Skip options" {
  run grep -F 'curl -fsSL https://dprint.dev/install.sh | sh' "$SKILL_DIR/SKILL.md"
  assert_success
  run grep -F '<path> upgrade' "$SKILL_DIR/SKILL.md"
  assert_success
  run grep -F 'multiSelect: false' "$SKILL_DIR/SKILL.md"
  assert_success
  run grep -F '`Skip`' "$SKILL_DIR/SKILL.md"
  assert_success
}

@test "SKILL.md never defines MIN_VERSION itself" {
  run grep -F 'MIN_VERSION =' "$SKILL_DIR/SKILL.md"
  assert_failure
}

@test "SKILL.md stays under 500 lines" {
  [ "$(wc -l < "$SKILL_DIR/SKILL.md")" -lt 500 ]
}

# core.fileMode = false in this repo, so `[ -x ]` passes even when git recorded 100644 — assert the index.
@test "hooks/detect.mjs is executable in the git index (100755)" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/dprint/hooks/detect.mjs
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/dprint/hooks/detect\.mjs$'
}
