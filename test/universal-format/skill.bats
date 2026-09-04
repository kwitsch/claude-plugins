#!/usr/bin/env bats

# universal-format skill (SKILL.md + format-files.mjs) — universal-format plugin.

load 'test_helper'

setup() {
  common_setup
}

SKILL="$BATS_TEST_DIRNAME/../../plugins/universal-format/skills/universal-format"

@test "universal-format SKILL.md exists and is non-empty" {
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
  run rg_or_grep -F 'format-files.reference.md' "$SKILL/SKILL.md"
  assert_success
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/format-files.mjs' "$SKILL/SKILL.md"
  assert_success
}

@test "SKILL.md never writes the exclamation-mark-then-backtick injection sequence" {
  run grep -cF '!`' "$SKILL/SKILL.md"
  assert_output "0"
}

@test "driver and its reference are colocated at the skill root" {
  run test -f "$SKILL/format-files.mjs"
  assert_success
  run test -f "$SKILL/format-files.reference.md"
  assert_success
}

@test "skill dir is self-contained (no cross-plugin references)" {
  run bash -c "
    if command -v rg >/dev/null 2>&1; then
      rg -i --no-ignore --hidden -a 'universal-lint|coding-toolbox|taskflow' '$SKILL/'
    else
      grep -riE 'universal-lint|coding-toolbox|taskflow' '$SKILL/'
    fi
  "
  assert_failure 1
}

@test "format-files.mjs reformats a Prettier-language file in place (no stub needed)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"a":1}' > "$cwd/f.json"
  printf '%s\n' "$cwd/f.json" > "$BATS_TEST_TMPDIR/list"
  run env PATH="$MOCKBIN" HOME="$HOME" bash -c "cd '$cwd' && node '$SKILL/format-files.mjs' '$BATS_TEST_TMPDIR/list'"
  assert_success
  assert_output --partial "formatted:"
  run cat "$cwd/f.json"
  assert_output --partial '"a": 1'
}

@test "format-files.mjs invokes the CLI formatter for a non-Prettier language" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'x=1\n' > "$cwd/f.py"
  export RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  rec_stub ruff
  printf '%s\n' "$cwd/f.py" > "$BATS_TEST_TMPDIR/list"
  run env PATH="$MOCKBIN" HOME="$HOME" RECORD="$RECORD" bash -c "cd '$cwd' && node '$SKILL/format-files.mjs' '$BATS_TEST_TMPDIR/list'"
  assert_success
  assert_output --partial "formatted:"
  run rg_or_grep -F "ruff " "$RECORD"
  assert_success
}

@test "format-files.mjs skips an unsupported extension" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'hello\n' > "$cwd/f.txt"
  printf '%s\n' "$cwd/f.txt" > "$BATS_TEST_TMPDIR/list"
  run env PATH="$MOCKBIN" HOME="$HOME" bash -c "cd '$cwd' && node '$SKILL/format-files.mjs' '$BATS_TEST_TMPDIR/list'"
  assert_success
  assert_output --partial "skipped (unsupported)"
}

@test "format-files.mjs exits 2 with no listfile argument" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run env PATH="$MOCKBIN" HOME="$HOME" node "$SKILL/format-files.mjs"
  assert_failure 2
}
