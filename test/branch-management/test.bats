#!/usr/bin/env bats
# Tests for branch-management: the three CLI review scripts
# (codex-review.sh, copilot-review.sh, coderabbit-review.sh) and the
# review-settings.sh toggle script.
#
# Strategy: each test runs a script with an isolated PATH that contains only
# symlinks to the required system tools plus per-test stub binaries for the
# reviewed CLI. Review-script exit-code contract: 0 review ran · 2 CLI
# missing · 3 not logged in · 4 run failed. review-settings.sh:
# exit 0 always, one `<tool>=true|false` line per review source, fail-open.

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPTS="$REPO_ROOT/plugins/branch-management/scripts"

  # Isolated PATH: required system tools only, stubs are added per test.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash env grep timeout sleep mktemp cat rm mkdir awk; do
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

# Stub body shared by the coderabbit happy-path tests: logged in + working review.
CODERABBIT_OK_STUB='if [ "$1" = "auth" ]; then echo "Logged in as tester"; exit 0; fi
if [ "$1" = "review" ]; then echo "CODERABBIT REVIEW OUTPUT $*"; exit 0; fi
exit 64'

#
# codex-review.sh
#

@test "codex: exit 2 when CLI is missing" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/codex-review.sh" main
  assert_failure 2
}

@test "codex: exit 3 when not logged in" {
  make_stub codex 'if [ "$1" = "login" ]; then [ "$2" = "status" ] || exit 99; exit 1; fi' 'exit 0'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/codex-review.sh" main
  assert_failure 3
}

@test "codex: passes review output through and targets origin/<base>" {
  make_stub codex \
    'if [ "$1" = "login" ]; then [ "$2" = "status" ] || exit 99; exit 0; fi' \
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
    'if [ "$1" = "login" ]; then [ "$2" = "status" ] || exit 99; exit 0; fi' \
    'if [ "$1" = "exec" ]; then sleep 5; fi'
  run env -i PATH="$MOCKBIN" HOME="$HOME" REVIEW_TIMEOUT=1 \
    bash "$SCRIPTS/codex-review.sh" main
  assert_failure 4
}

@test "codex: exit 4 when the review run fails" {
  make_stub codex \
    'if [ "$1" = "login" ]; then [ "$2" = "status" ] || exit 99; exit 0; fi' \
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

#
# copilot-review.sh
#

@test "copilot: exit 2 when CLI is missing" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/copilot-review.sh" main
  assert_failure 2
}

@test "copilot: exit 3 when no token env and no ~/.copilot state" {
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/copilot-review.sh" main
  assert_failure 3
}

@test "copilot: token env var satisfies the login heuristic" {
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT $*"; exit 0'
  run env -i PATH="$MOCKBIN" HOME="$HOME" GH_TOKEN=x \
    bash "$SCRIPTS/copilot-review.sh" main
  assert_success
  assert_output --partial "COPILOT REVIEW OUTPUT"
  assert_output --partial "origin/main"
}

@test "copilot: existing ~/.copilot satisfies the login heuristic" {
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  mkdir -p "$HOME/.copilot"
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/copilot-review.sh" main
  assert_success
}

@test "copilot: COPILOT_HOME override satisfies the login heuristic" {
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  mkdir -p "$BATS_TEST_TMPDIR/cphome"
  run env -i PATH="$MOCKBIN" HOME="$HOME" COPILOT_HOME="$BATS_TEST_TMPDIR/cphome" \
    bash "$SCRIPTS/copilot-review.sh" main
  assert_success
}

@test "copilot: auth failure in the output maps to exit 3" {
  make_stub copilot 'echo "Error: not logged in. Run /login" >&2; exit 1'
  run env -i PATH="$MOCKBIN" HOME="$HOME" GH_TOKEN=x \
    bash "$SCRIPTS/copilot-review.sh" main
  assert_failure 3
}

@test "copilot: other review failure maps to exit 4" {
  make_stub copilot 'echo "boom" >&2; exit 1'
  run env -i PATH="$MOCKBIN" HOME="$HOME" GH_TOKEN=x \
    bash "$SCRIPTS/copilot-review.sh" main
  assert_failure 4
  assert_output --partial "boom"
}

@test "copilot: stdout-only diagnostic survives an exit-4 failure" {
  make_stub copilot 'echo "FATAL: model backend unavailable (502)"; exit 1'
  run env -i PATH="$MOCKBIN" HOME="$HOME" GH_TOKEN=x \
    bash "$SCRIPTS/copilot-review.sh" main
  assert_failure 4
  assert_output --partial "FATAL: model backend unavailable"
}

@test "copilot: auth error with exit 0 maps to exit 3" {
  make_stub copilot 'echo "Error: not logged in. Run /login"; exit 0'
  run env -i PATH="$MOCKBIN" HOME="$HOME" GH_TOKEN=x \
    bash "$SCRIPTS/copilot-review.sh" main
  assert_failure 3
}

@test "copilot: finding text mentioning unauthorized does not fake exit 3" {
  make_stub copilot 'echo "major: code allows unauthorized access in auth.c"; exit 1'
  run env -i PATH="$MOCKBIN" HOME="$HOME" GH_TOKEN=x \
    bash "$SCRIPTS/copilot-review.sh" main
  assert_failure 4
}

@test "copilot: exit 4 when the review hangs (timeout)" {
  make_stub copilot 'sleep 5'
  run env -i PATH="$MOCKBIN" HOME="$HOME" GH_TOKEN=x REVIEW_TIMEOUT=1 \
    bash "$SCRIPTS/copilot-review.sh" main
  assert_failure 4
}

@test "copilot: usage error without base argument" {
  make_stub copilot 'exit 0'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/copilot-review.sh"
  assert_failure 1
  assert_output --partial "usage"
}

#
# coderabbit-review.sh
#

@test "coderabbit: exit 2 when neither coderabbit nor cr is installed" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/coderabbit-review.sh" main
  assert_failure 2
}

@test "coderabbit: exit 3 when not logged in" {
  make_stub coderabbit 'if [ "$1" = "auth" ]; then echo "Not logged in"; exit 0; fi'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/coderabbit-review.sh" main
  assert_failure 3
}

@test "coderabbit: unrecognizable auth output maps to exit 3" {
  make_stub coderabbit 'if [ "$1" = "auth" ]; then echo "???"; exit 0; fi'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/coderabbit-review.sh" main
  assert_failure 3
}

@test "coderabbit: 'Not currently authenticated' wording maps to exit 3" {
  make_stub coderabbit 'if [ "$1" = "auth" ]; then echo "Not currently authenticated to CodeRabbit"; exit 0; fi'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/coderabbit-review.sh" main
  assert_failure 3
}

@test "coderabbit: 'no longer logged in' wording maps to exit 3" {
  make_stub coderabbit 'if [ "$1" = "auth" ]; then echo "Session expired. You are no longer logged in"; exit 0; fi'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/coderabbit-review.sh" main
  assert_failure 3
}

@test "coderabbit: 'Authenticated' wording satisfies the login check" {
  make_stub coderabbit 'if [ "$1" = "auth" ]; then echo "Authenticated as tester"; exit 0; fi
if [ "$1" = "review" ]; then echo "CODERABBIT REVIEW OUTPUT"; exit 0; fi
exit 64'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/coderabbit-review.sh" main
  assert_success
}

@test "coderabbit: passes review output through with --prompt-only and --base" {
  make_stub coderabbit "$CODERABBIT_OK_STUB"
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/coderabbit-review.sh" main
  assert_success
  assert_output --partial "CODERABBIT REVIEW OUTPUT"
  assert_output --partial "--prompt-only"
  assert_output --partial "--base main"
}

@test "coderabbit: cr alias is found when coderabbit is absent" {
  make_stub cr "$CODERABBIT_OK_STUB"
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/coderabbit-review.sh" main
  assert_success
  assert_output --partial "CODERABBIT REVIEW OUTPUT"
}

@test "coderabbit: exit 4 when the review hangs (timeout)" {
  make_stub coderabbit 'if [ "$1" = "auth" ]; then echo "Logged in"; exit 0; fi
if [ "$1" = "review" ]; then sleep 5; fi'
  run env -i PATH="$MOCKBIN" HOME="$HOME" REVIEW_TIMEOUT=1 \
    bash "$SCRIPTS/coderabbit-review.sh" main
  assert_failure 4
}

@test "coderabbit: usage error without base argument" {
  make_stub coderabbit 'exit 0'
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/coderabbit-review.sh"
  assert_failure 1
  assert_output --partial "usage"
}

#
# review-settings.sh
#

# write_settings <file> <frontmatter-line>... — settings file with frontmatter.
write_settings() {
  local f="$1"; shift
  { printf -- '---\n'; printf '%s\n' "$@"; printf -- '---\n'; } > "$f"
}

# run_settings [arg]... — run review-settings.sh on the isolated PATH.
run_settings() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/review-settings.sh" "$@"
}

ALL_ENABLED=$'claude=true\ncodex=true\ncopilot=true\ncoderabbit=true'

@test "settings: all enabled when the settings file is missing" {
  run_settings "$BATS_TEST_TMPDIR/missing.md"
  assert_success
  assert_output "$ALL_ENABLED"
}

@test "settings: all enabled without a reviews block" {
  write_settings "$BATS_TEST_TMPDIR/s.md" 'other: value'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output "$ALL_ENABLED"
}

@test "settings: all enabled without frontmatter" {
  printf 'just some notes\n' > "$BATS_TEST_TMPDIR/s.md"
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output "$ALL_ENABLED"
}

@test "settings: explicit false disables exactly that review" {
  write_settings "$BATS_TEST_TMPDIR/s.md" 'reviews:' '  copilot: false'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output $'claude=true\ncodex=true\ncopilot=false\ncoderabbit=true'
}

@test "settings: all four can be disabled" {
  write_settings "$BATS_TEST_TMPDIR/s.md" 'reviews:' \
    '  claude: false' '  codex: false' '  copilot: false' '  coderabbit: false'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output $'claude=false\ncodex=false\ncopilot=false\ncoderabbit=false'
}

@test "settings: invalid value stays enabled (fail-open)" {
  write_settings "$BATS_TEST_TMPDIR/s.md" 'reviews:' '  copilot: no'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output "$ALL_ENABLED"
}

@test "settings: quoted false disables" {
  write_settings "$BATS_TEST_TMPDIR/s.md" 'reviews:' '  copilot: "false"'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output $'claude=true\ncodex=true\ncopilot=false\ncoderabbit=true'
}

@test "settings: capitalized False disables (case-insensitive)" {
  write_settings "$BATS_TEST_TMPDIR/s.md" 'reviews:' '  codex: False' '  copilot: FALSE'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output $'claude=true\ncodex=false\ncopilot=false\ncoderabbit=true'
}

@test "settings: duplicate key last occurrence wins" {
  write_settings "$BATS_TEST_TMPDIR/s.md" 'reviews:' '  copilot: false' '  copilot: true'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output "$ALL_ENABLED"
}

@test "settings: keys outside the reviews block are ignored" {
  write_settings "$BATS_TEST_TMPDIR/s.md" \
    'copilot: false' 'reviews:' '  codex: false' 'other:' '  claude: false'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output $'claude=true\ncodex=false\ncopilot=true\ncoderabbit=true'
}

@test "settings: nested sub-map keys are not toggles" {
  write_settings "$BATS_TEST_TMPDIR/s.md" 'reviews:' '  tools:' '    copilot: false'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output "$ALL_ENABLED"
}

@test "settings: reviews header with trailing comment is recognized" {
  write_settings "$BATS_TEST_TMPDIR/s.md" 'reviews: # toggles' '  copilot: false'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output $'claude=true\ncodex=true\ncopilot=false\ncoderabbit=true'
}

@test "settings: body after the closing fence is ignored" {
  { printf -- '---\nreviews:\n  codex: false\n---\n  copilot: false\n'; } > "$BATS_TEST_TMPDIR/s.md"
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output $'claude=true\ncodex=false\ncopilot=true\ncoderabbit=true'
}

@test "settings: UTF-8 BOM and CRLF line endings are tolerated" {
  printf -- '\357\273\277---\r\nreviews:\r\n  copilot: false\r\n---\r\n' > "$BATS_TEST_TMPDIR/s.md"
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output $'claude=true\ncodex=true\ncopilot=false\ncoderabbit=true'
}

@test "settings: script runs directly via its executable bit" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" "$SCRIPTS/review-settings.sh" "$BATS_TEST_TMPDIR/missing.md"
  assert_success
  assert_output "$ALL_ENABLED"
}

@test "settings: defaults without argument when git is unavailable" {
  cd "$BATS_TEST_TMPDIR"
  run_settings
  assert_success
  assert_output "$ALL_ENABLED"
}

@test "settings: no-arg run outside a repo falls back to \$PWD" {
  ln -s "$(command -v git)" "$MOCKBIN/git"
  mkdir -p "$BATS_TEST_TMPDIR/proj/.claude"
  write_settings "$BATS_TEST_TMPDIR/proj/.claude/branch-management.local.md" \
    'reviews:' '  copilot: false'
  cd "$BATS_TEST_TMPDIR/proj"
  run_settings
  assert_success
  assert_output $'claude=true\ncodex=true\ncopilot=false\ncoderabbit=true'
}

@test "settings: no-arg run inside a repo resolves the git toplevel" {
  ln -s "$(command -v git)" "$MOCKBIN/git"
  git init -q "$BATS_TEST_TMPDIR/repo"
  mkdir -p "$BATS_TEST_TMPDIR/repo/.claude" "$BATS_TEST_TMPDIR/repo/sub"
  write_settings "$BATS_TEST_TMPDIR/repo/.claude/branch-management.local.md" \
    'reviews:' '  codex: false'
  cd "$BATS_TEST_TMPDIR/repo/sub"
  run_settings
  assert_success
  assert_output $'claude=true\ncodex=false\ncopilot=true\ncoderabbit=true'
}

@test "settings: usage error with more than one argument" {
  run_settings a b
  assert_failure 1
  assert_output --partial "usage"
}
