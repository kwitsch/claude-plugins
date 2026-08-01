#!/usr/bin/env bats

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/kiwi-code-style"
  STYLE="$PLUGIN/output-styles/kiwi-code-style.md"
}

@test "plugin.json is valid and has required fields, no userConfig (deliberate — see CLAUDE.md)" {
  run jq -e '.name == "kiwi-code-style" and (.version | type == "string") and (.description | length > 0) and (.description | contains("ponytail")) and (has("userConfig") | not)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "marketplace.json has exactly one kiwi-code-style entry, no version field" {
  run jq -e '[.plugins[] | select(.name == "kiwi-code-style" and .source == "./plugins/kiwi-code-style")] | length == 1' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
  run jq -e '[.plugins[] | select(.name == "kiwi-code-style") | has("version")] | any | not' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "output style file exists at the plugin-name path" {
  [ -f "$STYLE" ]
}

@test "output style frontmatter has the 3 load-bearing keys, inside the actual frontmatter block" {
  # Only lines strictly between the first and second '---' fence count as
  # frontmatter — a substring match over the first N lines can't tell a real
  # key from the same text appearing later in body prose.
  # The closing fence must exist too, else every body line would count as
  # frontmatter and a file missing it would still pass.
  run awk '/^---$/{n++; next} n==1{print} END{if (n < 2) exit 1}' "$STYLE"
  assert_success
  assert_output --partial 'name: kiwi-code-style'
  assert_output --partial 'keep-coding-instructions: true'
  assert_output --partial 'force-for-plugin: true'
}

@test "output style body starts with the contract heading" {
  # The first non-empty line after the closing fence must BE the heading —
  # 'appears somewhere near the top' would also pass a body that starts with
  # something else.
  run awk '/^---$/{n++; next} n >= 2 && NF {print; exit}' "$STYLE"
  assert_output '# OUTPUT FORMAT — MANDATORY'
}

@test "plugin-local .markdownlint.json extends root config and disables only MD038" {
  run jq -e '(keys == ["MD038", "extends"]) and .extends == "../../.markdownlint.json" and .MD038 == false' "$PLUGIN/.markdownlint.json"
  assert_success
}

@test "the literal dash-space token survives formatting" {
  run grep -F '` — ` separator per line' "$STYLE"
  assert_success
}

@test "hooks/hooks.json exists, points at the right script, and has no matcher" {
  HOOKS="$PLUGIN/hooks/hooks.json"
  [ -f "$HOOKS" ]
  run jq -e '.hooks.SessionStart[0].hooks[0].command == "${CLAUDE_PLUGIN_ROOT}/hooks/inject-ponytail-guidelines.mjs"' "$HOOKS"
  assert_success
  run jq -e '.hooks.SessionStart[0].hooks[0].type == "command"' "$HOOKS"
  assert_success
  run jq -e '.hooks.SessionStart[0] | has("matcher") | not' "$HOOKS"
  assert_success
}

@test "inject-ponytail-guidelines.mjs is executable in the git index (100755)" {
  # Reads the INDEX (what `git update-index --chmod=+x` writes), not the
  # committed tree -- this test runs before the task's own commit exists,
  # so `git ls-tree HEAD` would false-fail here even once staged correctly.
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/kiwi-code-style/hooks/inject-ponytail-guidelines.mjs
  assert_output --partial '100755'
}

@test "inject-ponytail-guidelines.mjs still emits guidelines when invoked via a symlink" {
  ln -sf "$PLUGIN/hooks/inject-ponytail-guidelines.mjs" "$BATS_TEST_TMPDIR/link.mjs"
  run node "$BATS_TEST_TMPDIR/link.mjs"
  assert_success
  assert_output --partial '"hookEventName":"SessionStart"'
}

@test "ponytail-guidelines.md exists" {
  # The 5 section headings are asserted on this same real file by
  # hooks.test.mjs ("bundled ponytail-guidelines.md strips clean and keeps
  # all 5 sections") -- no need to duplicate that check in bats too.
  [ -f "$PLUGIN/hooks/ponytail-guidelines.md" ]
}

@test "ponytail-guidelines.md has no lite/ultra intensity variability" {
  GUIDE="$PLUGIN/hooks/ponytail-guidelines.md"
  run grep -F 'argument-hint' "$GUIDE"; assert_failure
  run grep -F 'Intensity levels:' "$GUIDE"; assert_failure
  run grep -F '/ponytail lite|full|ultra' "$GUIDE"; assert_failure
}

@test "ponytail-guidelines.md has no kiwi-conflicting plan-format example" {
  GUIDE="$PLUGIN/hooks/ponytail-guidelines.md"
  run grep -F 'state a brief plan' "$GUIDE"; assert_failure
  run grep -F '[Step] → verify: [check]' "$GUIDE"; assert_failure
}

@test "ponytail-guidelines.md carries MIT attribution and passes prettier --check" {
  GUIDE="$PLUGIN/hooks/ponytail-guidelines.md"
  run grep -F 'License: MIT' "$GUIDE"; assert_success
  run npx prettier --check "$GUIDE"
  assert_success
}

@test "plugin.json version bumped to 0.2.0 for the ponytail hook feature" {
  run jq -e '.version == "0.2.0"' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}
