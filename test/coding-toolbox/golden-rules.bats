#!/usr/bin/env bats

# golden-rules.md content — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "golden-rules.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/setup-rules/references/golden-rules.md"
  assert_success
}
@test "golden-rules.md covers all four axes and cites all three sourced axes" {
  run cat "$PLUGIN/skills/setup-rules/references/golden-rules.md"
  assert_success
  assert_output --partial "Interaction"
  assert_output --partial "AskUserQuestion"
  assert_output --partial "Language"
  assert_output --partial "Behavior"
  assert_output --partial "Mentality"
  assert_output --partial "cavemem"
  assert_output --partial "andrej-karpathy-skills"
  assert_output --partial "ponytail-lite"
}
@test "golden-rules.md forbids ending a turn with a bare '?'" {
  run cat "$PLUGIN/skills/setup-rules/references/golden-rules.md"
  assert_success
  assert_output --partial 'bare "?"'
}
