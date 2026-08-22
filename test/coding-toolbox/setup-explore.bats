#!/usr/bin/env bats

# setup-explore skill — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "setup-explore SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/setup-explore/SKILL.md"
  assert_success
}
@test "setup-explore is user-only (disable-model-invocation: true)" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/setup-explore/SKILL.md'"
  assert_success
  assert_output --partial "disable-model-invocation: true"
}
@test "setup-explore detects codebase-memory-mcp via command -v" {
  run rg_or_grep -F 'command -v codebase-memory-mcp' "$PLUGIN/skills/setup-explore/SKILL.md"
  assert_success
}
@test "setup-explore's write is symlink-safe and atomic (mktemp + mv, no bare cat> onto the managed path)" {
  run rg_or_grep -F 'mktemp' "$PLUGIN/skills/setup-explore/SKILL.md"
  assert_success
  run rg_or_grep -F 'mv -f "$tmp" "$HOME/.claude/agents/explore.md"' "$PLUGIN/skills/setup-explore/SKILL.md"
  assert_success
  run rg_or_grep -F 'cat > "$HOME/.claude/agents/explore.md"' "$PLUGIN/skills/setup-explore/SKILL.md"
  assert_failure
}
@test "setup-explore's apply step reads from references/, never inlines either variant's body" {
  run rg_or_grep -F 'skills/setup-explore/references/' "$PLUGIN/skills/setup-explore/SKILL.md"
  assert_success
  run rg_or_grep -F 'READ-ONLY MODE' "$PLUGIN/skills/setup-explore/SKILL.md"
  assert_failure
}
@test "setup-explore documents the disableSkillShellExecution guard" {
  run rg_or_grep -F '[shell command execution disabled by policy]' "$PLUGIN/skills/setup-explore/SKILL.md"
  assert_success
}
@test "setup-explore bundles both reference variants, each with name: explore frontmatter" {
  local plain="$PLUGIN/skills/setup-explore/references/explore.initial-haiku.md"
  local cmm="$PLUGIN/skills/setup-explore/references/explore.codebase-memory.md"
  run test -s "$plain"
  assert_success
  run test -s "$cmm"
  assert_success
  run rg_or_grep -F 'name: explore' "$plain"
  assert_success
  run rg_or_grep -F 'name: explore' "$cmm"
  assert_success
}
@test "plugin README lists setup-explore in the Skills section" {
  run rg_or_grep -F '| `setup-explore`' "$PLUGIN/README.md"
  assert_success
}
@test "plugin README no longer lists explore in an Agents section" {
  run rg_or_grep -F '| `explore`' "$PLUGIN/README.md"
  assert_failure
}
@test "plugin.json no longer declares explore_agent_reroute userConfig" {
  run jq -e '.userConfig | has("explore_agent_reroute") | not' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}
@test "coding-toolbox no longer ships a plugin-level explore agent" {
  run test -e "$PLUGIN/agents/explore.md"
  assert_failure
}

@test "setup-explore captures the plugin root via bare substitution, never inside its load-time detect block" {
  run rg_or_grep -F 'Plugin root: ${CLAUDE_PLUGIN_ROOT}' "$PLUGIN/skills/setup-explore/SKILL.md"
  assert_success
  run rg_or_grep -F 'echo "Plugin root: $CLAUDE_PLUGIN_ROOT"' "$PLUGIN/skills/setup-explore/SKILL.md"
  assert_failure
}
