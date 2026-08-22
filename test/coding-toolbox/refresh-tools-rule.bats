#!/usr/bin/env bats

# refresh-tools-rule skill — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "refresh-tools-rule SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
}
@test "refresh-tools-rule is model-invocable (no disable-model-invocation key)" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/refresh-tools-rule/SKILL.md'"
  assert_success
  assert_output --partial "name: refresh-tools-rule"
  refute_output --partial "disable-model-invocation"
}
@test "refresh-tools-rule never installs or removes — no rm, no mkdir, no golden-rules cp" {
  run rg_or_grep -c -F -e 'rm -f' -e 'rm ' -e 'mkdir' -e 'golden-rules.md' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_failure
}
@test "refresh-tools-rule gates on the tools-rule file already existing before writing anything" {
  run rg_or_grep -F 'does **not** mention' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  run rg_or_grep -F 'Never create the file' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
}
@test "refresh-tools-rule's write is symlink-safe and atomic (no bare cat> onto the managed path)" {
  run rg_or_grep -F -- '-L "$target"' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  run rg_or_grep -F 'mktemp' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  run rg_or_grep -F 'mv -f "$tmp" "$target"' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  run rg_or_grep -F 'cat > "$HOME/.claude/rules/coding-toolbox-tools.md"' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_failure
}
@test "refresh-tools-rule detects all four tools via command -v" {
  run rg_or_grep -c -e 'command -v rtk' -e 'command -v bun' -e 'command -v rg' -e 'command -v codebase-memory-mcp' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  assert_output "4"
}
@test "tool-routing-rows.md reference file exists with all four candidate rows, each in its own fenced block" {
  local rows="$PLUGIN/skills/setup-rules/references/tool-routing-rows.md"
  run test -s "$rows"
  assert_success
  for tool in rtk bun ripgrep codebase-memory; do
    run rg_or_grep -F "### $tool" "$rows"
    assert_success
  done
  run rg_or_grep -c -F -e '### rtk' -e '### bun' -e '### ripgrep' -e '### codebase-memory' "$rows"
  assert_success
  assert_output "4"
}
@test "setup-rules and refresh-tools-rule both read the shared tool-routing-rows.md, never inline the table" {
  run rg_or_grep -F 'references/tool-routing-rows.md' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  run rg_or_grep -F 'references/tool-routing-rows.md' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  run rg_or_grep -F 'rtk <cmd>' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_failure
  run rg_or_grep -F 'rtk <cmd>' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_failure
}
@test "plugin README lists refresh-tools-rule in the Skills section" {
  run rg_or_grep -F '| `refresh-tools-rule`' "$PLUGIN/README.md"
  assert_success
}

@test "refresh-tools-rule captures the plugin root via bare substitution, never inside its load-time detect block" {
  run rg_or_grep -F 'Plugin root: ${CLAUDE_PLUGIN_ROOT}' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  run rg_or_grep -F 'echo "Plugin root: $CLAUDE_PLUGIN_ROOT"' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_failure
}
