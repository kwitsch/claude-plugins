#!/usr/bin/env bats

# .claude/skills/update-linux-token-efficiency/SKILL.md — frontmatter + step ordering.

load 'test_helper'

setup() {
  common_setup
  SKILL="$SKILL_DIR/SKILL.md"
}

@test "SKILL.md exists and is non-empty" {
  [ -s "$SKILL" ]
}

@test "frontmatter declares name, argument-hint, disable-model-invocation and allowed-tools" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$SKILL'"
  assert_success
  assert_output --partial "name: update-linux-token-efficiency"
  assert_output --partial 'argument-hint: "[check|apply]"'
  assert_output --partial "disable-model-invocation: true"
  assert_output --partial "allowed-tools: Read, Bash"
}

@test "SKILL.md reads the reference doc in the step immediately before invoking the script" {
  local ref_line invoke_line
  ref_line="$(grep -n 'update-rtk-bundle.reference.md' "$SKILL" | head -n 1 | cut -d: -f1)"
  invoke_line="$(grep -n 'update-rtk-bundle.sh --repo-root' "$SKILL" | head -n 1 | cut -d: -f1)"
  [ -n "$ref_line" ]
  [ -n "$invoke_line" ]
  [ "$ref_line" -lt "$invoke_line" ]
}

@test "SKILL.md invokes the script by repo-relative path, not CLAUDE_SKILL_DIR" {
  run grep -F 'bash .claude/skills/update-linux-token-efficiency/update-rtk-bundle.sh' "$SKILL"
  assert_success
  run grep -F 'CLAUDE_SKILL_DIR' "$SKILL"
  assert_failure
}

@test "SKILL.md carries the disabled-shell-execution guard sentence" {
  run grep -F '[shell command execution disabled by policy]' "$SKILL"
  assert_success
}

@test "SKILL.md points at the reference doc for exit codes instead of duplicating the table" {
  run grep -E '^\| 11 +\|' "$SKILL"
  assert_failure
}

@test "SKILL.md prints the exec-bit follow-up commands for the human" {
  run grep -F 'git update-index --chmod=+x plugins/linux-token-efficiency/bin/rtk' "$SKILL"
  assert_success
  run grep -F 'git ls-files -s plugins/linux-token-efficiency/bin/rtk' "$SKILL"
  assert_success
}
