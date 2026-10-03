#!/usr/bin/env bats

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/inline-headroom"
  MANIFEST="$PLUGIN/.claude-plugin/plugin.json"
  MARKETPLACE="$REPO_ROOT/.claude-plugin/marketplace.json"
}

@test "plugin.json has name, author Kwitsch and a non-empty description" {
  run jq -e '.name == "inline-headroom" and .author.name == "Kwitsch" and (.description | length > 0)' "$MANIFEST"
  assert_success
}

@test "plugin.json version is 0.1.0" {
  run jq -e '.version == "0.1.0"' "$MANIFEST"
  assert_success
}

@test "userConfig declares exactly the two boolean feature toggles, both default true" {
  run jq -e '(.userConfig | keys) == ["cache_aligner_enabled","effort_routing_enabled"]' "$MANIFEST"
  assert_success
  run jq -e '(.userConfig | length) == 2' "$MANIFEST"
  assert_success
  run jq -e '[.userConfig[] | select(.type == "boolean" and .default == true and (.title | length > 0) and (.description | length > 0))] | length == 2' "$MANIFEST"
  assert_success
}

@test "hooks.json is exactly the mods module list" {
  run jq -e '. == {"modules":["./register.ts"]}' "$PLUGIN/hooks/hooks.json"
  assert_success
}

@test "mod source and wiring-test files exist" {
  [ -f "$PLUGIN/hooks/register.ts" ]
  [ -f "$PLUGIN/hooks/policy.mjs" ]
  [ -f "$PLUGIN/tests/inline-headroom.test.ts" ]
}

@test "marketplace.json has exactly one inline-headroom entry with the right source and no version" {
  run jq -e '[.plugins[] | select(.name == "inline-headroom" and .source == "./plugins/inline-headroom")] | length == 1' "$MARKETPLACE"
  assert_success
  run jq -e '[.plugins[] | select(.name == "inline-headroom") | has("version")] | any | not' "$MARKETPLACE"
  assert_success
  run jq -e '.plugins[] | select(.name == "inline-headroom") | .author.name == "Kwitsch"' "$MARKETPLACE"
  assert_success
}

@test "marketplace.json inline-headroom description is byte-identical to plugin.json" {
  plugin_desc="$(jq -r '.description' "$MANIFEST")"
  market_desc="$(jq -r '.plugins[] | select(.name == "inline-headroom") | .description' "$MARKETPLACE")"
  [ "$plugin_desc" = "$market_desc" ]
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
