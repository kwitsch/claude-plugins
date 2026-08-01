#!/usr/bin/env bats

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/kiwi-code-style"
  STYLE="$PLUGIN/output-styles/kiwi-code-style.md"
}

@test "plugin.json is valid and has required fields, no userConfig (deliberate — see CLAUDE.md)" {
  run jq -e '.name == "kiwi-code-style" and (.version | type == "string") and (.description | length > 0) and (has("userConfig") | not)' "$PLUGIN/.claude-plugin/plugin.json"
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

@test ".prettierignore exempts the output style file from reformatting" {
  run grep -Fx 'plugins/kiwi-code-style/output-styles/kiwi-code-style.md' "$REPO_ROOT/.prettierignore"
  assert_success
}
