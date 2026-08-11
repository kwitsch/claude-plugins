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

@test "plugin README documents the bundled cbm version, toggle and cache" {
  run grep -F '0.10.1' "$PLUGIN_README"
  assert_success
  run grep -F 'cbm_enabled' "$PLUGIN_README"
  assert_success
  run grep -F 'only the literal value `false` disables' "$PLUGIN_README"
  assert_success
  run grep -F '${CLAUDE_PLUGIN_DATA}/cbm' "$PLUGIN_README"
  assert_success
  run grep -F 'rm -rf' "$PLUGIN_README"
  assert_success
}

@test "plugin README names all four cbm hooks and the no-approval-prompt behavior" {
  for token in 'SessionStart' 'SubagentStart' 'Grep' 'Glob' 'Read' 'codebase-memory'; do
    run grep -F "$token" "$PLUGIN_README"
    assert_success
  done
  run grep -Fi 'no separate' "$PLUGIN_README"
  assert_success
  run grep -Fi 'restart' "$PLUGIN_README"
  assert_success
}

@test "plugin CLAUDE.md carries the codebase-memory-mcp bundle section and its rationale" {
  run grep -F '## codebase-memory-mcp bundle' "$PLUGIN_CLAUDE"
  assert_success
  for token in 'fail-open' 'npm-automations' '${CLAUDE_PLUGIN_DATA}' 'cbm-checksums.txt' 'CBM_NO_EXTRACT' 'CBM_CACHE_DIR' '100 MiB' 'command'; do
    run grep -F "$token" "$PLUGIN_CLAUDE"
    assert_success
  done
}

@test "root README and plugins/CLAUDE.md rows mention the cbm bundle" {
  run grep -F '[linux-token-efficiency](plugins/linux-token-efficiency/README.md)' "$REPO_ROOT/README.md"
  assert_success
  run bash -c "grep -F '[linux-token-efficiency](plugins/linux-token-efficiency/README.md)' '$REPO_ROOT/README.md' | grep -F 'codebase-memory-mcp'"
  assert_success
  run grep -F 'codebase-memory-mcp' "$REPO_ROOT/plugins/CLAUDE.md"
  assert_success
}
