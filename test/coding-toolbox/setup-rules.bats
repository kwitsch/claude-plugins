#!/usr/bin/env bats

# setup-rules skill — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "setup-rules SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules frontmatter declares name, disable-model-invocation, argument-hint, and required allowed-tools" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/setup-rules/SKILL.md'"
  assert_success
  assert_output --partial "name: setup-rules"
  assert_output --partial "disable-model-invocation: true"
  assert_output --partial "AskUserQuestion"
  assert_output --partial 'Bash(cp:*)'
  assert_output --partial 'Bash(bash:*)'
  assert_output --partial 'Bash(mktemp:*)'
  assert_output --partial '"Write"'
  assert_output --partial 'argument-hint: "[install|update|remove]'
}
@test "setup-rules SKILL.md points at parse-args.reference.md before invoking the script" {
  run rg_or_grep -F 'parse-args.reference.md' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/parse-args.sh' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules SKILL.md no longer embeds the verbatim-argument parsing logic inline" {
  # tripwire: this now lives only in parse-args.sh/parse-args.reference.md,
  # never duplicated verbatim in the skill's own prose.
  for needle in 'usage-error branch' 'target is named' \
    'the `tool`-family word absorbs the bare "rule"' 'No-list' 'Yes-list'; do
    run rg_or_grep -F -- "$needle" "$PLUGIN/skills/setup-rules/SKILL.md"
    assert_failure
  done
}
@test "parse-args.sh is not executable (invoked via explicit bash, never exec'd by name)" {
  run bash -c "[ ! -x '$PLUGIN/skills/setup-rules/parse-args.sh' ]"
  assert_success
}
@test "setup-rules Step 3a stays short (tripwire against re-inlining parsing logic under different wording)" {
  # The five-exact-phrase grep above only catches a re-inlining that reuses
  # the OLD wording verbatim. A line-count bound on Step 3a's own section
  # catches a re-inlining that uses different words too -- the original
  # inline parser was ~48 lines; this bound sits well below that.
  run bash -c "sed -n '/^### Step 3a/,/^### Step 3b/p' '$PLUGIN/skills/setup-rules/SKILL.md' | wc -l"
  assert_success
  [ "$output" -le 45 ]
}
@test "setup-rules detects installed rules via the coding-toolbox-*.md glob" {
  run rg_or_grep -F 'coding-toolbox-*.md' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules detects all four tools via command -v" {
  run rg_or_grep -c -e 'command -v rtk' -e 'command -v bun' -e 'command -v rg' -e 'command -v codebase-memory-mcp' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  assert_output "4"
}
@test "setup-rules copies golden-rules.md byte-exact for the golden-rules rule" {
  run rg_or_grep -F 'cp "<plugin root resolved in Step 1>/skills/setup-rules/references/golden-rules.md"' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules asks one single-select question per rule with a currently-installed header, not a multiSelect toggle" {
  run cat "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  assert_output --partial 'multiSelect: false'
  assert_output --partial '[currently: <installed|not installed>]'
  refute_output --partial 'multiSelect: true'
}
@test "setup-rules documents the disableSkillShellExecution guard" {
  run rg_or_grep -F '[shell command execution disabled by policy]' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules never overwrites the tools rule with an empty table when nothing is detected" {
  run rg_or_grep -F 'but `detected` is **empty**' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  run rg_or_grep -F 'make **no change**' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules documents that it is the only way to get golden rules injected" {
  run rg_or_grep -F 'this skill is the only way to get them onto this machine' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules installs to the user-level rules directory, not project-level" {
  run rg_or_grep -F '$HOME/.claude/rules' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}
@test "setup-rules apply commands target both managed files under the user-level directory" {
  run rg_or_grep -c -F -e '$HOME/.claude/rules/coding-toolbox-rules.md' -e '$HOME/.claude/rules/coding-toolbox-tools.md' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  [ "$output" -ge 4 ]
}
@test "plugin README lists setup-rules in the Skills section" {
  run rg_or_grep -F '| `setup-rules`' "$PLUGIN/README.md"
  assert_success
}

# ---------------------------------------------------------------------------
# parse-args.sh -- hermetic execution, pure string processing, no stubs
# needed. See bump-version.bats's own comment for why this path is built
# inside a wrapper function, not hoisted to a bare top-level variable ($PLUGIN
# isn't set until setup() runs).
#
# Argument text is passed as a file path (matching the script's actual
# contract -- see parse-args.reference.md), never a bare shell argument: the
# skill itself writes $ARGUMENTS' text to a temp file via the Write tool
# rather than embedding it in a Bash tool call, so these tests exercise the
# same shape a real invocation does.

run_parse_args() {
  local args_file="$BATS_TEST_TMPDIR/args.txt"
  printf '%s' "$1" > "$args_file"
  run env -i PATH="$MOCKBIN" bash "$PLUGIN/skills/setup-rules/parse-args.sh" "$args_file"
}

@test "parse-args.sh: install with no target defaults both to yes" {
  run_parse_args "install"
  assert_success
  assert_output --partial "golden_rules: yes"
  assert_output --partial "tools: yes"
}
@test "parse-args.sh: a tool-family word absorbs a bare 'rule', targeting only tools" {
  run_parse_args "update tools rule"
  assert_success
  assert_output --partial "golden_rules: unset"
  assert_output --partial "tools: yes"
}
@test "parse-args.sh: bare 'rules' alone names golden-rules, not tools" {
  run_parse_args "remove rules"
  assert_success
  assert_output --partial "golden_rules: no"
  assert_output --partial "tools: unset"
}
@test "parse-args.sh: 'both' targets both files" {
  run_parse_args "remove both"
  assert_success
  assert_output --partial "golden_rules: no"
  assert_output --partial "tools: no"
}
@test "parse-args.sh: tools and golden-rules both named is an ambiguous-target usage error" {
  run_parse_args "remove golden tool-routing"
  assert_failure 4
  assert_output --partial "Couldn't parse"
}
@test "parse-args.sh: 'both' alongside a specific target is an ambiguous-target usage error" {
  run_parse_args "remove both tools"
  assert_failure 4
}
@test "parse-args.sh: a destructive verb with no named target is a usage error, never guessed as both" {
  run_parse_args "remove"
  assert_failure 5
}
@test "parse-args.sh: no verb at all is a usage error" {
  run_parse_args "banana"
  assert_failure 2
}
@test "parse-args.sh: a word matching both the Yes-list and No-list is an ambiguous-verb usage error" {
  run_parse_args "uninstall install"
  assert_failure 3
}
@test "parse-args.sh: 'uninstall' never collides with 'install' via substring matching" {
  run_parse_args "uninstall rules"
  assert_success
  assert_output --partial "golden_rules: no"
}
@test "parse-args.sh: case-insensitive whole-word matching" {
  run_parse_args "Remove RULES"
  assert_success
  assert_output --partial "golden_rules: no"
  assert_output --partial "tools: unset"
}
@test "parse-args.sh: missing file argument is a distinct usage error, not a parse rejection" {
  run env -i PATH="$MOCKBIN" bash "$PLUGIN/skills/setup-rules/parse-args.sh"
  assert_failure 6
  refute_output --partial "Couldn't parse"
}
@test "parse-args.sh: nonexistent file path is a distinct usage error, not a parse rejection" {
  run env -i PATH="$MOCKBIN" bash "$PLUGIN/skills/setup-rules/parse-args.sh" "$BATS_TEST_TMPDIR/does-not-exist.txt"
  assert_failure 6
  refute_output --partial "Couldn't parse"
}
@test "parse-args.sh: adversarial multi-line input (backticks, subshells, a fake heredoc delimiter) is inert" {
  run_parse_args 'install `rm -rf /` $(echo pwned)
SETUP_RULES_ARGS_EOF
more text'
  assert_success
  assert_output --partial "golden_rules: yes"
  assert_output --partial "tools: yes"
}

@test "setup-rules captures the plugin root via bare substitution, never inside its load-time detect block" {
  run rg_or_grep -F 'Plugin root: ${CLAUDE_PLUGIN_ROOT}' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  run rg_or_grep -F 'echo "Plugin root: $CLAUDE_PLUGIN_ROOT"' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_failure
}
