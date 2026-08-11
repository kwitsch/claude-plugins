#!/usr/bin/env bats

# README / CLAUDE.md / registration completeness — linux-token-efficiency.

load 'test_helper'

setup() {
  common_setup
  PLUGIN_README="$PLUGIN/README.md"
  PLUGIN_CLAUDE="$PLUGIN/CLAUDE.md"
}

@test "plugin README's first section is Install with the marketplace install command" {
  run bash -c "grep -m1 '^## ' '$PLUGIN_README'"
  assert_output '## Install'
  run grep -F '/plugin install linux-token-efficiency@kwitsch-plugins' "$PLUGIN_README"
  assert_success
}

@test "plugin README warns Linux-only and states the bundled rtk version" {
  run grep -Fi 'linux' "$PLUGIN_README"
  assert_success
  run grep -F '0.45.0' "$PLUGIN_README"
  assert_success
}

@test "plugin README documents the auto_rewrite toggle and how to set it" {
  run grep -F 'auto_rewrite' "$PLUGIN_README"
  assert_success
  run grep -F 'pluginConfigs' "$PLUGIN_README"
  assert_success
  run grep -F '/plugin manage' "$PLUGIN_README"
  assert_success
}

@test "plugin README documents exactly when the hook no-ops" {
  run grep -Fi 'global' "$PLUGIN_README"
  assert_success
  run grep -Fi 'no-op' "$PLUGIN_README"
  assert_success
}

@test "plugin CLAUDE.md carries the required sections" {
  run grep -F '## Skill design (update-linux-token-efficiency)' "$PLUGIN_CLAUDE"
  assert_success
  run grep -F '## userConfig' "$PLUGIN_CLAUDE"
  assert_success
}

@test "plugin CLAUDE.md restates the git update-index --chmod=+x requirement" {
  run grep -F 'git update-index --chmod=+x' "$PLUGIN_CLAUDE"
  assert_success
  run grep -F 'core.fileMode' "$PLUGIN_CLAUDE"
  assert_success
}

@test "plugin CLAUDE.md documents the novel-in-repo mechanics" {
  for token in 'spawnSync' 'checksums.txt' 'jq' 'curl'; do
    run grep -F "$token" "$PLUGIN_CLAUDE"
    assert_success
  done
}

@test "root README plugins table has a linux-token-efficiency row" {
  run grep -F '[linux-token-efficiency](plugins/linux-token-efficiency/README.md)' "$REPO_ROOT/README.md"
  assert_success
}

@test "plugins/CLAUDE.md references the plugin from its bin/ row" {
  run grep -F 'linux-token-efficiency' "$REPO_ROOT/plugins/CLAUDE.md"
  assert_success
}
