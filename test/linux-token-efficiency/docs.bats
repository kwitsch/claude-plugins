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

@test "plugin README warns Linux-only and describes the latest checksums-verified release" {
  run grep -Fi 'linux' "$PLUGIN_README"
  assert_success
  run grep -Fi 'latest' "$PLUGIN_README"
  assert_success
  run grep -F 'checksums.txt' "$PLUGIN_README"
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
  run grep -F '## userConfig' "$PLUGIN_CLAUDE"
  assert_success
  run grep -F '## Output style' "$PLUGIN_CLAUDE"
  assert_success
}

@test "plugin CLAUDE.md restates the git update-index --chmod=+x requirement" {
  run grep -F 'git update-index --chmod=+x' "$PLUGIN_CLAUDE"
  assert_success
  run grep -F 'core.fileMode' "$PLUGIN_CLAUDE"
  assert_success
}

@test "plugin CLAUDE.md documents the novel-in-repo mechanics" {
  for token in 'spawnSync' 'checksums.txt' 'curl'; do
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

@test "plugin README documents the cbm toggle and download cache" {
  run grep -F 'cbm_enabled' "$PLUGIN_README"
  assert_success
  run grep -F 'only the literal value `false` disables' "$PLUGIN_README"
  assert_success
  run grep -F '${CLAUDE_PLUGIN_DATA}/cbm' "$PLUGIN_README"
  assert_success
  run grep -F 'rm -rf' "$PLUGIN_README"
  assert_success
  run grep -F 'mcp/server.mjs' "$PLUGIN_README"
  assert_success
  run grep -Fi 'download' "$PLUGIN_README"
  assert_success
  run grep -Fi 'sha256' "$PLUGIN_README"
  assert_success
}

@test "plugin README names all four cbm hooks, mcp_tool, and the no-approval-prompt behavior" {
  for token in 'SessionStart' 'SubagentStart' 'Grep' 'Glob' 'Read' 'codebase-memory' 'mcp_tool'; do
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
  for token in 'fail-open' 'npm-automations' '${CLAUDE_PLUGIN_DATA}' 'CBM_CACHE_DIR' '100 MiB' 'mcp_tool' 'mcp/server.mjs' 'cbm-tools.json' 'CBM_BUNDLE_CACHE'; do
    run grep -F "$token" "$PLUGIN_CLAUDE"
    assert_success
  done
  run grep -F 'timeout: 20' "$PLUGIN_CLAUDE"
  assert_success
  run grep -Fi 'network' "$PLUGIN_CLAUDE"
  assert_success
}

@test "root README and plugins/CLAUDE.md rows mention the cbm bundle" {
  run grep -F '[linux-token-efficiency](plugins/linux-token-efficiency/README.md)' "$REPO_ROOT/README.md"
  assert_success
  run bash -c "grep -F '[linux-token-efficiency](plugins/linux-token-efficiency/README.md)' '$REPO_ROOT/README.md' | grep -F 'codebase-memory-mcp'"
  assert_success
  run grep -F 'codebase-memory-mcp' "$REPO_ROOT/plugins/CLAUDE.md"
  assert_success
}

@test "no dead cbm reference survives anywhere in the repo" {
  # Excludes this file itself (its own literal search pattern is a trivial self-match, not a
  # dead reference) and the pre-existing cbm-bundle.bats/skill.bats suites, whose lines matching
  # these tokens are themselves absence-check literals (grep -F ... ; assert_failure) rather than
  # surviving references. portable.tar.gz is checked separately below as a tracked-file guard,
  # since the string itself is also the real, still-correct upstream release asset name.
  run bash -c "git -C '$REPO_ROOT' grep -lE 'cbm-launch\.sh|cbm-checksums\.txt|CBM_NO_EXTRACT' -- . \
    ':!*.lock' ':!test/linux-token-efficiency/docs.bats' ':!test/linux-token-efficiency/cbm-bundle.bats' \
    ':!test/linux-token-efficiency/skill.bats' | grep -c . || true"
  assert_output '0'
  run bash -c "git -C '$REPO_ROOT' ls-files -- '*.tar.gz' | grep -c . || true"
  assert_output '0'
}

@test "plugins/CLAUDE.md describes this plugin's mcp/ directory and both bin/ entries" {
  run bash -c "grep -F 'linux-token-efficiency' '$REPO_ROOT/plugins/CLAUDE.md' | grep -F 'mcp/'"
  assert_success
  run bash -c "grep -F '| \`bin/\`' '$REPO_ROOT/plugins/CLAUDE.md' | grep -Fi 'tarball'"
  assert_failure
  # The bin/ row must no longer claim an rtk-only bin/.
  run bash -c "grep -F '| \`bin/\`' '$REPO_ROOT/plugins/CLAUDE.md' | grep -F 'context-mode-launch.sh'"
  assert_success
  run bash -c "grep -F '| \`bin/\`' '$REPO_ROOT/plugins/CLAUDE.md' | grep -Fi 'holds only that'"
  assert_failure
}

@test "plugin README documents the context-mode server and the pinned package" {
  local token
  for token in 'context-mode' 'bunx' 'npx --yes' 'ctx_execute' 'Elastic' 'mcp__plugin_linux-token-efficiency_context-mode__' '1.0.169' 'SessionStart.md'; do
    run grep -F "$token" "$PLUGIN_README"
    assert_success
  done
}

@test "plugin README and CLAUDE.md both state the BLOCKED divergence" {
  local f
  for f in "$PLUGIN_README" "$PLUGIN_CLAUDE"; do
    run grep -F 'BLOCKED' "$f"
    assert_success
    run grep -Fi 'intercept' "$f"
    assert_success
  done
}

@test "plugin CLAUDE.md carries the context-mode section with the launcher rationale" {
  run grep -F '## context-mode' "$PLUGIN_CLAUDE"
  assert_success
  local token
  for token in 'context-mode@1.0.169' 'bunx' 'npx --yes' 'ctx_execute' 'SessionStart.md' 'Elastic' '.prettierignore' '.coderabbit.yaml'; do
    run grep -F "$token" "$PLUGIN_CLAUDE"
    assert_success
  done
}

@test "plugin CLAUDE.md states the unconditional-cat limitation and the nine-hook count" {
  run grep -Fi 'unconditional' "$PLUGIN_CLAUDE"
  assert_success
  run grep -F 'nine hooks total' "$PLUGIN_CLAUDE"
  assert_success
  run grep -F 'eight hooks total' "$PLUGIN_CLAUDE"
  assert_failure
  run grep -F 'Nine hooks total.' "$HOOKS"
  assert_success
  # Ties both hardcoded "nine" claims above to the actual hook count, so a future hook
  # addition/removal that forgets to update this prose is caught structurally instead
  # of only by string-matching a hardcoded number (same derivation as context-mode.bats
  # / cbm-hooks.bats use for their own hooks.json structural assertions).
  run jq -e '([.hooks[][].hooks | length] | add) == 9' "$HOOKS"
  assert_success
}

@test "plugin CLAUDE.md and the root README carry the context-mode history note and row clause" {
  run grep -F 'cave-context' "$PLUGIN_CLAUDE"
  assert_success
  run grep -F '2026-07' "$PLUGIN_CLAUDE"
  assert_success
  run bash -c "grep -F '[linux-token-efficiency](plugins/linux-token-efficiency/README.md)' '$REPO_ROOT/README.md' | grep -F 'context-mode'"
  assert_success
}

@test "plugin README documents the forced terse output style" {
  for token in 'output-styles/terse.md' 'force-for-plugin' 'keep-coding-instructions'; do
    run grep -F "$token" "$PLUGIN_README"
    assert_success
  done
  run grep -Fi 'override' "$PLUGIN_README"
  assert_success
}

@test "plugin README documents the ~/.local/bin install and the rtk_enabled toggle" {
  run grep -F '~/.local/bin/rtk' "$PLUGIN_README"
  assert_success
  run grep -F 'rtk_enabled' "$PLUGIN_README"
  assert_success
  # No doc still asserts the vendored code-span `bin/rtk` path.
  run grep -F '`bin/rtk`' "$PLUGIN_README"
  assert_failure
}

@test "plugin CLAUDE.md carries the rtk install section and no longer describes a committed binary" {
  run grep -F '## rtk install' "$PLUGIN_CLAUDE"
  assert_success
  run grep -F 'hooks/rtk-install.mjs' "$PLUGIN_CLAUDE"
  assert_success
  run grep -F '## Committed binary and the exec bit' "$PLUGIN_CLAUDE"
  assert_failure
}

@test "plugins/CLAUDE.md bin/ row no longer claims a committed release binary" {
  run grep -F 'committed release binary' "$REPO_ROOT/plugins/CLAUDE.md"
  assert_failure
}
