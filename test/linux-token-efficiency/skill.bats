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
  local ref_line invoke_line between_steps
  ref_line="$(grep -n 'update-rtk-bundle.reference.md' "$SKILL" | head -n 1 | cut -d: -f1)"
  invoke_line="$(grep -n 'update-rtk-bundle.sh --repo-root' "$SKILL" | head -n 1 | cut -d: -f1)"
  [ -n "$ref_line" ]
  [ -n "$invoke_line" ]
  [ "$ref_line" -lt "$invoke_line" ]
  # Exactly one heading (the invoking step's own) may appear between the two lines --
  # anything more means a step got wedged between the reference read and the invocation.
  between_steps="$(sed -n "$((ref_line + 1)),$((invoke_line - 1))p" "$SKILL" | grep -c '^## ' || true)"
  [ "$between_steps" -eq 1 ]
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

@test "frontmatter description names both bundled artifacts" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$SKILL'"
  assert_success
  assert_output --partial "rtk"
  assert_output --partial "codebase-memory-mcp"
}

@test "SKILL.md reads both reference docs in the same step, before either invocation" {
  local rtk_ref cbm_ref first_invoke between
  rtk_ref="$(grep -n 'update-rtk-bundle.reference.md' "$SKILL" | head -n 1 | cut -d: -f1)"
  cbm_ref="$(grep -n 'update-cbm-bundle.reference.md' "$SKILL" | head -n 1 | cut -d: -f1)"
  first_invoke="$(grep -n -e 'update-rtk-bundle.sh --repo-root' -e 'update-cbm-bundle.sh --repo-root' "$SKILL" | head -n 1 | cut -d: -f1)"
  [ -n "$rtk_ref" ]
  [ -n "$cbm_ref" ]
  [ -n "$first_invoke" ]
  [ "$rtk_ref" -lt "$first_invoke" ]
  [ "$cbm_ref" -lt "$first_invoke" ]
  # No heading between the two reference reads: they belong to the same step.
  if [ "$rtk_ref" -lt "$cbm_ref" ]; then
    between="$(sed -n "$((rtk_ref + 1)),$((cbm_ref - 1))p" "$SKILL" | grep -c '^## ' || true)"
  else
    between="$(sed -n "$((cbm_ref + 1)),$((rtk_ref - 1))p" "$SKILL" | grep -c '^## ' || true)"
  fi
  [ "$between" -eq 0 ]
}

@test "SKILL.md detects the cbm pin, invokes the cbm script and prints its follow-up block" {
  run grep -F "jq -r '.cbmVersion" "$SKILL"
  assert_success
  run grep -F 'bash .claude/skills/update-linux-token-efficiency/update-cbm-bundle.sh' "$SKILL"
  assert_success
  run grep -F 'git add plugins/linux-token-efficiency/bin/codebase-memory-mcp-linux-amd64-portable.tar.gz' "$SKILL"
  assert_success
  run grep -F 'git ls-files -s plugins/linux-token-efficiency/bin/cbm-launch.sh' "$SKILL"
  assert_success
}
