#!/usr/bin/env bats

# universal-lint skill (SKILL.md + lint-files.mjs) — universal-lint plugin.

load 'test_helper'

setup() {
  common_setup
}

SKILL="$BATS_TEST_DIRNAME/../../plugins/universal-lint/skills/universal-lint"

@test "universal-lint SKILL.md exists and is non-empty" {
  run test -s "$SKILL/SKILL.md"
  assert_success
}

@test "SKILL.md frontmatter: user-only, arguments file_scope, scoped allowed-tools (no bare Bash)" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$SKILL/SKILL.md'"
  assert_success
  assert_output --partial "disable-model-invocation: true"
  assert_output --partial "arguments: file_scope"
  assert_output --partial '"Glob"'
  assert_output --partial '"AskUserQuestion"'
  assert_output --partial '"Bash(git:*)"'
  refute_output --partial '"Bash"'
}

@test "SKILL.md points at the reference doc and invokes the driver via the literal token" {
  run rg_or_grep -F 'lint-files.reference.md' "$SKILL/SKILL.md"
  assert_success
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/lint-files.mjs' "$SKILL/SKILL.md"
  assert_success
}

@test "SKILL.md never writes the exclamation-mark-then-backtick injection sequence" {
  run grep -cF '!`' "$SKILL/SKILL.md"
  assert_output "0"
}

@test "driver and its reference are colocated at the skill root" {
  run test -f "$SKILL/lint-files.mjs"
  assert_success
  run test -f "$SKILL/lint-files.reference.md"
  assert_success
}

@test "skill dir is self-contained (no cross-plugin references)" {
  run bash -c "
    if command -v rg >/dev/null 2>&1; then
      rg -i --no-ignore --hidden -a 'universal-format|coding-toolbox|taskflow' '$SKILL/'
    else
      grep -riE 'universal-format|coding-toolbox|taskflow' '$SKILL/'
    fi
  "
  assert_failure 1
}

@test "driver never invokes a fix/format/write path (read-only)" {
  run rg_or_grep -iE -- '--fix|--format|--write' "$SKILL/lint-files.mjs"
  assert_failure
}

@test "skill dir does not use the off-label debounce knob" {
  run bash -c "grep -rF 'UNIVERSAL_LINT_DEBOUNCE_MS' '$SKILL/'"
  assert_failure
}

@test "lint-files.mjs reports an aggregated finding for a supported file" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  export RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  export OUT='a.sh:1:6: note: Double quote to prevent globbing. [SC2086]'
  rec_stub shellcheck 1
  printf '%s\n' "$cwd/a.sh" > "$BATS_TEST_TMPDIR/list"
  run env PATH="$MOCKBIN" HOME="$HOME" RECORD="$RECORD" OUT="$OUT" bash -c "cd '$cwd' && node '$SKILL/lint-files.mjs' '$BATS_TEST_TMPDIR/list'"
  assert_success
  assert_output --partial "SC2086"
  assert_output --partial "universal-lint:"
}

@test "lint-files.mjs prints no-findings for a clean file" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo hi\n' > "$cwd/a.sh"
  export RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  export OUT='no problems'
  rec_stub shellcheck 0
  printf '%s\n' "$cwd/a.sh" > "$BATS_TEST_TMPDIR/list"
  run env PATH="$MOCKBIN" HOME="$HOME" RECORD="$RECORD" OUT="$OUT" bash -c "cd '$cwd' && node '$SKILL/lint-files.mjs' '$BATS_TEST_TMPDIR/list'"
  assert_success
  assert_output --partial "no findings"
}

@test "lint-files.mjs skips an unsupported extension (.json): no findings, linter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"a":1}\n' > "$cwd/a.json"
  export RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  export OUT='x'
  rec_stub shellcheck 1
  printf '%s\n' "$cwd/a.json" > "$BATS_TEST_TMPDIR/list"
  run env PATH="$MOCKBIN" HOME="$HOME" RECORD="$RECORD" OUT="$OUT" bash -c "cd '$cwd' && node '$SKILL/lint-files.mjs' '$BATS_TEST_TMPDIR/list'"
  assert_success
  assert_output --partial "no findings"
  [ ! -s "$RECORD" ]
}

@test "lint-files.mjs exits 2 with no listfile argument" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run env PATH="$MOCKBIN" HOME="$HOME" node "$SKILL/lint-files.mjs"
  assert_failure 2
}
