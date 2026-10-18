#!/usr/bin/env bats
# Manifest and wiring for git-sign-key. The rewrite and SessionStart logic is
# covered by sign.test.mjs (node:test, pnpm run test:unit) and the hook wiring by
# plugins/git-sign-key/tests/git-sign-key.test.ts (claude plugin test).

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/git-sign-key"
  MANIFEST="$PLUGIN/.claude-plugin/plugin.json"
  MARKETPLACE="$REPO_ROOT/.claude-plugin/marketplace.json"
}

@test "plugin.json is valid JSON with name and version 1.2.0" {
  run jq -e '.name == "git-sign-key" and .version == "1.2.0"' "$MANIFEST"
  assert_success
}

@test "hooks.json is exactly the mods module list" {
  run jq -e '. == {"modules":["./register.ts"]}' "$PLUGIN/hooks/hooks.json"
  assert_success
}

@test "mod source and wiring-test files exist; the command-hook scripts are gone" {
  [ -f "$PLUGIN/hooks/register.ts" ]
  [ -f "$PLUGIN/hooks/sign.mjs" ]
  [ -f "$PLUGIN/tests/git-sign-key.test.ts" ]
  [ ! -e "$PLUGIN/hooks/sign-commits.sh" ]
  [ ! -e "$PLUGIN/hooks/check-sign-key.sh" ]
}

# core.fileMode = false in this repo, so `[ -x ]` passes even when git recorded 100644 — assert the index.
@test "hooks/sign.mjs is executable in the git index (100755)" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/git-sign-key/hooks/sign.mjs
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/git-sign-key/hooks/sign\.mjs$'
}

@test "marketplace.json has exactly one git-sign-key entry with no version" {
  run jq -e '[.plugins[] | select(.name == "git-sign-key" and .source == "./plugins/git-sign-key")] | length == 1' "$MARKETPLACE"
  assert_success
  run jq -e '[.plugins[] | select(.name == "git-sign-key") | has("version")] | any | not' "$MARKETPLACE"
  assert_success
}

@test "claude plugin validate succeeds" {
  command -v claude >/dev/null || skip "claude CLI unavailable"
  run claude plugin validate "$PLUGIN"
  assert_success
}

@test "claude plugin test succeeds" {
  command -v claude >/dev/null || skip "claude CLI unavailable"
  run claude plugin test "$PLUGIN"
  assert_success
}
