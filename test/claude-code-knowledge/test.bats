#!/usr/bin/env bats
# Tests for the claude-code-knowledge plugin: manifest invariants, the two
# command hooks (redirect-guide, session-cache), the cc-knowledge agent,
# the shared references, the cck-* skills, and the hermetic harness selftest.

setup() {
  bats_require_minimum_version 1.5.0
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/claude-code-knowledge"
  BIN="$PLUGIN/bin"
}

@test "plugin.json is valid JSON" {
  run -0 jq empty "$PLUGIN/.claude-plugin/plugin.json"
}

@test "plugin.json declares the right name and a version" {
  run -0 jq -e '.name == "claude-code-knowledge" and (.version | type == "string")' \
    "$PLUGIN/.claude-plugin/plugin.json"
}

@test "marketplace lists the plugin and carries no version field there" {
  run -0 jq -e '.plugins[] | select(.name == "claude-code-knowledge") | (has("version") | not)' \
    "$REPO_ROOT/.claude-plugin/marketplace.json"
}
