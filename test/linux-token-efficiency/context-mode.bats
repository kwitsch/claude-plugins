#!/usr/bin/env bats

# context-mode: the bin/context-mode-launch.sh launcher, the `context-mode` MCP server entry,
# the verbatim hooks/SessionStart.md document, its SessionStart `cat` hook, the deny-steer
# hook wiring (hook_webfetch_steer mcp_tool and rtk-rewrite.mjs's steer branch) and the
# verbatim-file guards. Hermetic: `bunx`/`npx` are always stubs on an isolated PATH, so no
# npm-registry request is ever made.

load 'test_helper'

setup() {
  common_setup
  WRAPPER="$PLUGIN/bin/context-mode-launch.sh"
  # Stub dir for the package runners. It is FIRST on the test PATH; MOCKBIN follows and
  # supplies `bash` for the shebang (env -i would otherwise fail to resolve it) and holds
  # no bunx/npx of its own, so "neither runner available" is reproducible.
  CM_BIN="$BATS_TEST_TMPDIR/cmbin"
  mkdir -p "$CM_BIN"
  CM_RECORD="$BATS_TEST_TMPDIR/runner-record"
  : > "$CM_RECORD"
}

# runner_stub <name> -- an executable stub that records "<name> <argv>" and exits 0. It uses
# bash's own ${0##*/} (not basename, which MOCKBIN does not provide) because `exec` through
# PATH sets $0 to the resolved stub path, not the bare name. Forwards through "$@", not "$*":
# the latter pre-flattens argv into a single joined word before printf ever sees it, which
# would mask a future forwarding bug (e.g. an argument boundary collapsed into two plain args).
runner_stub() {
  make_stub_in "$CM_BIN" "$1" \
    'printf "%s" "${0##*/}" >> "$CM_RECORD"; printf " %s" "$@" >> "$CM_RECORD"; printf "\n" >> "$CM_RECORD"'
}

# cm_run [VAR=VALUE ...] -- run the real wrapper on the isolated PATH. env -i wipes
# BATS_TEST_TMPDIR, so TMPDIR and CM_RECORD are forwarded explicitly.
cm_run() {
  run env -i PATH="$CM_BIN:$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    CM_RECORD="$CM_RECORD" "$@" "$WRAPPER"
}

@test "bin/context-mode-launch.sh is an executable bash program in the git index (100755)" {
  [ -x "$WRAPPER" ]
  run head -n 1 "$WRAPPER"
  assert_output '#!/usr/bin/env bash'
  run bash -n "$WRAPPER"
  assert_success
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/bin/context-mode-launch.sh
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/bin/context-mode-launch\.sh$'
}

@test ".gitattributes keeps the launcher textual while bin/rtk stays binary" {
  run grep -F -- 'plugins/linux-token-efficiency/bin/*.sh -binary' "$REPO_ROOT/.gitattributes"
  assert_success
  run git -C "$REPO_ROOT" check-attr binary -- plugins/linux-token-efficiency/bin/context-mode-launch.sh
  assert_success
  assert_output --partial 'binary: unset'
  run git -C "$REPO_ROOT" check-attr binary -- plugins/linux-token-efficiency/bin/rtk
  assert_success
  assert_output --partial 'binary: set'
}

@test "the launcher pins the exact context-mode package version 1.0.169" {
  # Rolling pin, same convention as the plugin.json version test: rewritten (never deleted)
  # whenever the package spec moves.
  run grep -F 'context-mode@1.0.169' "$WRAPPER"
  assert_success
  run grep -E 'context-mode@(latest|\*)?"' "$WRAPPER"
  assert_failure
  run grep -F 'npx -y ' "$WRAPPER"
  assert_failure
  run grep -F 'command -v node' "$WRAPPER"
  assert_failure
}

@test "bunx wins when both package runners resolve" {
  runner_stub bunx
  runner_stub npx
  cm_run
  assert_success
  run cat "$CM_RECORD"
  assert_output 'bunx context-mode@1.0.169'
}

@test "npx --yes is the fallback when only npx resolves" {
  runner_stub npx
  cm_run
  assert_success
  run cat "$CM_RECORD"
  assert_output 'npx --yes context-mode@1.0.169'
}

@test "neither runner: exit 1, named message on stderr, clean stdout" {
  run --separate-stderr env -i PATH="$CM_BIN:$MOCKBIN" HOME="$HOME" \
    TMPDIR="$BATS_TEST_TMPDIR" "$WRAPPER"
  assert_failure 1
  [ -z "$output" ]
  [[ "$stderr" == *'neither bunx nor npx is available'* ]]
}

@test "extra argv is forwarded verbatim to the package runner" {
  runner_stub bunx
  # Not cm_run: that helper's "$@" precedes "$WRAPPER" so env can keep consuming
  # NAME=VALUE assignments (what the fail-open test needs); positional argv like
  # --flag/value must instead land after "$WRAPPER" to be forwarded to it.
  run env -i PATH="$CM_BIN:$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    CM_RECORD="$CM_RECORD" "$WRAPPER" --flag value
  assert_success
  run cat "$CM_RECORD"
  assert_output 'bunx context-mode@1.0.169 --flag value'
}

@test "no env var disables the launcher: it always execs regardless of stray env" {
  runner_stub bunx
  local v
  for v in '' 'false' 'true' '${user_config.context_mode_enabled}'; do
    : > "$CM_RECORD"
    cm_run CLAUDE_PLUGIN_OPTION_CONTEXT_MODE_ENABLED="$v"
    assert_success
    run cat "$CM_RECORD"
    assert_output 'bunx context-mode@1.0.169'
  done
}

@test ".mcp.json registers the context-mode server behind the launcher, no env" {
  run jq -e '.mcpServers | keys == ["codebase-memory","context-mode"]' "$MCP_JSON"
  assert_success
  run jq -e '.mcpServers["context-mode"] | .command == "${CLAUDE_PLUGIN_ROOT}/bin/context-mode-launch.sh" and (has("args") | not) and (has("env") | not)' "$MCP_JSON"
  assert_success
}

@test "hooks/SessionStart.md is upstream's routing document verbatim, tracked 100644" {
  local ss="$PLUGIN/hooks/SessionStart.md"
  [ -s "$ss" ]
  run head -n 1 "$ss"
  assert_output '# context-mode — MANDATORY routing rules'
  run tail -n 1 "$ss"
  assert_output 'After /clear or /compact: knowledge base and session stats preserved. Use `ctx purge` to start fresh.'
  # The research-notes boundary marker is the notes author's, never upstream content.
  run grep -F 'END OF SessionStart.md CONTENT' "$ss"
  assert_failure
  local token
  for token in 'ctx_batch_execute' 'ctx_execute_file' 'ctx_fetch_and_index' 'ctx_purge' 'DO NOT ask "what were we working on?"'; do
    run grep -F "$token" "$ss"
    assert_success
  done
  # No exec bit: .claude/rules/hooks-executable.md globs only hooks/*.sh and hooks/*.mjs.
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/hooks/SessionStart.md
  assert_success
  assert_line --regexp '^100644 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/hooks/SessionStart\.md$'
}

@test "the SessionStart cat entry is a second top-level entry in exec form" {
  run jq -e '(.hooks.SessionStart | length) == 2' "$HOOKS"
  assert_success
  run jq -e '.hooks.SessionStart[1].hooks[0] == {type:"command", command:"cat", args:["${CLAUDE_PLUGIN_ROOT}/hooks/SessionStart.md"], timeout:5}' "$HOOKS"
  assert_success
  run jq -e '.hooks.SessionStart[1] | (has("matcher") | not) and (.hooks | length) == 1' "$HOOKS"
  assert_success
  run jq -e '.hooks.SessionStart[1].hooks[0] | has("async") | not' "$HOOKS"
  assert_success
  # Index-0 shape (the command hook calling mcp/linux-token-efficiency-mcp --session-start-hook)
  # is pinned by cbm-hooks.bats, not duplicated here.
}

@test "cat on SessionStart.md through an isolated PATH reproduces the document" {
  local ss="$PLUGIN/hooks/SessionStart.md"
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" cat "$ss"
  assert_success
  [ "$output" = "$(cat "$ss")" ]
}

@test "hooks/subagent-nudge.md is a static file with both nudge points, tracked 100644" {
  local nudge="$PLUGIN/hooks/subagent-nudge.md"
  [ -s "$nudge" ]
  run grep -F 'final report' "$nudge"
  assert_success
  run grep -F 'context-mode' "$nudge"
  assert_success
  run grep -F 'ctx_' "$nudge"
  assert_success
  # No exec bit: same rule as hooks/SessionStart.md.
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/hooks/subagent-nudge.md
  assert_success
  assert_line --regexp '^100644 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/hooks/subagent-nudge\.md$'
}

@test "cat on subagent-nudge.md through an isolated PATH reproduces the file" {
  local nudge="$PLUGIN/hooks/subagent-nudge.md"
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" cat "$nudge"
  assert_success
  [ "$output" = "$(cat "$nudge")" ]
}

@test "hooks.json wires subagent-nudge.md as a second SubagentStart cat entry" {
  run jq -e '(.hooks.SubagentStart | length) == 2' "$HOOKS"
  assert_success
  run jq -e '.hooks.SubagentStart[1].hooks[0] == {type:"command", command:"cat", args:["${CLAUDE_PLUGIN_ROOT}/hooks/subagent-nudge.md"], timeout:5}' "$HOOKS"
  assert_success
  run jq -e '.hooks.SubagentStart[1] | (has("matcher") | not) and (.hooks | length) == 1' "$HOOKS"
  assert_success
  # Index-0 shape (hook_subagent_context on the cbm mcp_tool server) is pinned by
  # cbm-hooks.bats, not duplicated here.
}

# --- steering hooks (revisits the earlier zero-nudge decision: dynamic deny-steers with
# --- copy-ready replacement calls, not upstream's static context_guidance tips) ---

@test "PreToolUse holds exactly Bash, Grep|Glob and WebFetch; PostToolUse stays untouched" {
  run jq -e '(.hooks.PreToolUse | length) == 3 and (.hooks.PostToolUse | length) == 1' "$HOOKS"
  assert_success
  run jq -e '[.hooks.PreToolUse[].matcher] == ["Bash","Grep|Glob","WebFetch"]' "$HOOKS"
  assert_success
  # Assert on handler fields, not raw strings: the top-level description legitimately
  # contains "context-mode".
  run jq -e '[.hooks[][].hooks[] | select(.type == "mcp_tool") | .server] | unique == ["plugin:linux-token-efficiency:codebase-memory"]' "$HOOKS"
  assert_success
  # Upstream's static per-call tips remain rejected; steering is dynamic deny only.
  run grep -F 'context_guidance' "$HOOKS"
  assert_failure
}

@test "hooks.json wires PreToolUse/WebFetch to the hook_webfetch_steer mcp_tool" {
  run jq -e '.hooks.PreToolUse[2] | .matcher == "WebFetch" and (.hooks[0] | .type == "mcp_tool" and .server == "plugin:linux-token-efficiency:codebase-memory" and .tool == "hook_webfetch_steer" and .timeout == 20 and .input == {tool_input:{url:"${tool_input.url}"}})' "$HOOKS"
  assert_success
}

@test "the verbatim file is guarded by .prettierignore and .coderabbit.yaml, and the cave-context orphan is gone" {
  run grep -F 'plugins/linux-token-efficiency/hooks/SessionStart.md' "$REPO_ROOT/.prettierignore"
  assert_success
  # `--` is load-bearing: the pattern starts with "- ", which grep would otherwise
  # parse as an option (same reason as the .gitattributes test above).
  run grep -F -- '- "!plugins/linux-token-efficiency/hooks/SessionStart.md"' "$REPO_ROOT/.coderabbit.yaml"
  assert_success
  run bash -c "grep -ci 'cave-context' '$REPO_ROOT/.coderabbit.yaml' || true"
  assert_output '0'
}
