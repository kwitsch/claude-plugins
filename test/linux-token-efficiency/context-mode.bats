#!/usr/bin/env bats

# context-mode: the bin/context-mode-launch.sh launcher, the `context-mode` MCP server entry,
# the verbatim hooks/SessionStart.md document, its SessionStart `cat` hook, and the
# zero-nudge-hook / verbatim-file guards. Hermetic: `bunx`/`npx` are always stubs on an
# isolated PATH, so no npm-registry request is ever made.

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
# PATH sets $0 to the resolved stub path, not the bare name.
runner_stub() {
  make_stub_in "$CM_BIN" "$1" 'printf "%s %s\n" "${0##*/}" "$*" >> "$CM_RECORD"'
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

@test "context_mode_enabled=false exits 0, execs nothing, names the toggle on stderr only" {
  runner_stub bunx
  runner_stub npx
  run --separate-stderr env -i PATH="$CM_BIN:$MOCKBIN" HOME="$HOME" \
    TMPDIR="$BATS_TEST_TMPDIR" CM_RECORD="$CM_RECORD" \
    CLAUDE_PLUGIN_OPTION_CONTEXT_MODE_ENABLED=false "$WRAPPER"
  assert_success
  [ -z "$output" ]
  [[ "$stderr" == *'context_mode_enabled'* ]]
  [ ! -s "$CM_RECORD" ]
}

@test "fail-open: unset, empty, true and an uninterpolated placeholder all exec" {
  runner_stub bunx
  local v
  cm_run
  assert_success
  run cat "$CM_RECORD"
  assert_output 'bunx context-mode@1.0.169'
  for v in '' 'true' '${user_config.context_mode_enabled}'; do
    : > "$CM_RECORD"
    cm_run CLAUDE_PLUGIN_OPTION_CONTEXT_MODE_ENABLED="$v"
    assert_success
    run cat "$CM_RECORD"
    assert_output 'bunx context-mode@1.0.169'
  done
}
