#!/usr/bin/env bats
# Tests for branch-management: the three CLI review scripts
# (codex-review.sh, copilot-review.sh, coderabbit-review.sh).
#
# Strategy: each test runs a script with an isolated PATH that contains only
# symlinks to the required system tools plus per-test stub binaries for the
# reviewed CLI. Exit-code contract: 0 review ran · 2 CLI missing ·
# 3 not logged in · 4 review run failed.

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPTS="$REPO_ROOT/plugins/branch-management/scripts"

  # Isolated PATH: required system tools only, stubs are added per test.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash env grep timeout sleep mktemp cat rm mkdir; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -s "$src" "$MOCKBIN/$t"
  done

  # Isolated HOME so ~/.copilot is under our control.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"
}

# make_stub <name> <body-line>... — drop an executable stub into MOCKBIN.
make_stub() {
  local name="$1"; shift
  { printf '#!/usr/bin/env bash\n'; printf '%s\n' "$@"; } > "$MOCKBIN/$name"
  chmod +x "$MOCKBIN/$name"
}

#
# codex-review.sh
#

@test "codex: exit 2 when CLI is missing" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/codex-review.sh" main
  assert_failure 2
}

@test "codex: exit 3 when not logged in" {
  make_stub codex 'if [ "$1" = "login" ]; then exit 1; fi' 'exit 0'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/codex-review.sh" main
  assert_failure 3
}

@test "codex: passes review output through and targets origin/<base>" {
  make_stub codex \
    'if [ "$1" = "login" ]; then exit 0; fi' \
    'if [ "$1" = "exec" ]; then echo "CODEX REVIEW OUTPUT $*"; exit 0; fi' \
    'exit 64'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/codex-review.sh" main
  assert_success
  assert_output --partial "CODEX REVIEW OUTPUT"
  assert_output --partial "origin/main"        # diff target must be in the prompt
  assert_output --partial "read-only"          # sandbox flag must be passed
}

@test "codex: exit 4 when the review hangs (timeout)" {
  make_stub codex \
    'if [ "$1" = "login" ]; then exit 0; fi' \
    'if [ "$1" = "exec" ]; then sleep 5; fi'
  run env -i PATH="$MOCKBIN" HOME="$HOME" REVIEW_TIMEOUT=1 \
    bash "$SCRIPTS/codex-review.sh" main
  assert_failure 4
}

@test "codex: exit 4 when the review run fails" {
  make_stub codex \
    'if [ "$1" = "login" ]; then exit 0; fi' \
    'if [ "$1" = "exec" ]; then echo boom >&2; exit 1; fi'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/codex-review.sh" main
  assert_failure 4
}

@test "codex: usage error without base argument" {
  make_stub codex 'exit 0'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/codex-review.sh"
  assert_failure 1
  assert_output --partial "usage"
}
