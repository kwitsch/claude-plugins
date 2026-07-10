#!/usr/bin/env bats

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOKS="$REPO_ROOT/plugins/memory-enhancement/hooks/hooks.json"
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS"
  assert_success
}

# TODO: add behavioral tests for this plugin's hooks here.
