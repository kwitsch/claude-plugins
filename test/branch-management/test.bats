#!/usr/bin/env bats
# Tests for branch-management: the three CLI review scripts
# (codex-review.sh, copilot-review.sh, coderabbit-review.sh), the
# review-settings.sh toggle script and the ci-watch.sh CI poller.
#
# Strategy: each test runs a script with an isolated PATH that contains only
# symlinks to the required system tools plus per-test stub binaries for the
# reviewed CLI. Review-script exit-code contract: 0 review ran · 2 CLI
# missing · 3 not logged in · 4 run failed. review-settings.sh:
# exit 0 always, one `<tool>=true|false` line per review source, fail-open.
# ci-watch.sh: 0 green · 1 red · 2 deadline · 64 usage/environment; stubs
# mirror real gh/glab exit codes and output formats.

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

# write_user_settings <frontmatter-line>... — user-level settings in the
# isolated HOME.
write_user_settings() {
  mkdir -p "$HOME/.claude"
  write_settings "$HOME/.claude/branch-management.local.md" "$@"
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

@test "settings: user-level config applies when no project file exists" {
  write_user_settings 'reviews:' '  copilot: false'
  run_settings "$BATS_TEST_TMPDIR/missing.md"
  assert_success
  assert_output $'claude=true\ncodex=true\ncopilot=false\ncoderabbit=true'
}

@test "settings: project level overrides user level per key" {
  write_user_settings 'reviews:' '  copilot: false' '  codex: false'
  write_settings "$BATS_TEST_TMPDIR/s.md" 'reviews:' '  copilot: true'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output $'claude=true\ncodex=false\ncopilot=true\ncoderabbit=true'
}

@test "settings: invalid project value does not override user-level false" {
  write_user_settings 'reviews:' '  copilot: false'
  write_settings "$BATS_TEST_TMPDIR/s.md" 'reviews:' '  copilot: off'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output $'claude=true\ncodex=true\ncopilot=false\ncoderabbit=true'
}

@test "settings: unreadable user layer is skipped, project still applies" {
  [ "$(id -u)" -eq 0 ] && skip "root can read anything"
  write_user_settings 'reviews:' '  copilot: false'
  chmod 000 "$HOME/.claude/branch-management.local.md"
  write_settings "$BATS_TEST_TMPDIR/s.md" 'reviews:' '  codex: false'
  run_settings "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output $'claude=true\ncodex=false\ncopilot=true\ncoderabbit=true'
}

@test "settings: BOM is stripped under a UTF-8 locale" {
  printf -- '\357\273\277---\nreviews:\n  copilot: false\n---\n' > "$BATS_TEST_TMPDIR/s.md"
  run env -i PATH="$MOCKBIN" HOME="$HOME" LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    bash "$SCRIPTS/review-settings.sh" "$BATS_TEST_TMPDIR/s.md"
  assert_success
  assert_output $'claude=true\ncodex=true\ncopilot=false\ncoderabbit=true'
}

@test "settings: no-arg run merges user and project level" {
  ln -s "$(command -v git)" "$MOCKBIN/git"
  git init -q "$BATS_TEST_TMPDIR/repo"
  mkdir -p "$BATS_TEST_TMPDIR/repo/.claude"
  write_user_settings 'reviews:' '  claude: false'
  write_settings "$BATS_TEST_TMPDIR/repo/.claude/branch-management.local.md" \
    'reviews:' '  codex: false'
  cd "$BATS_TEST_TMPDIR/repo"
  run_settings
  assert_success
  assert_output $'claude=false\ncodex=false\ncopilot=true\ncoderabbit=true'
}

@test "settings: usage error with more than one argument" {
  run_settings a b
  assert_failure 1
  assert_output --partial "usage"
}

#
# ci-watch.sh
#
# Stubs mirror REAL CLI behavior: gh pr checks exits 0 all-pass, 1 when a
# check failed OR no checks are reported (stderr message, empty stdout),
# 8 while any check is pending — data goes to stdout regardless. glab ci
# get separates `status:` from its value with a TAB in text mode and
# supports --output json on current versions.

# run_ci_watch <platform> <ref> — run ci-watch.sh on the isolated PATH with
# test-friendly timing (no sleep between polls, 2 s overall deadline).
run_ci_watch() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" STATE_DIR="$BATS_TEST_TMPDIR" \
    CI_WATCH_INTERVAL=0 CI_WATCH_TIMEOUT=2 \
    bash "$SCRIPTS/ci-watch.sh" "$@"
}

@test "ci-watch: usage error without arguments" {
  run_ci_watch
  assert_failure 64
  assert_output --partial "usage"
}

@test "ci-watch: usage error on unknown platform" {
  run_ci_watch bitbucket 5
  assert_failure 64
  assert_output --partial "usage"
}

@test "ci-watch: exit 64 when the platform CLI is not installed" {
  run_ci_watch github 5
  assert_failure 64
  assert_output --partial "not installed"
}

@test "ci-watch: github green when all real checks pass" {
  make_stub gh 'printf "pass\tbuild\npass\ttest\n"; exit 0'
  run_ci_watch github 5
  assert_success
}

@test "ci-watch: github passes the expected gh arguments" {
  make_stub gh 'echo "$*" > "$STATE_DIR/gh-args"; printf "pass\tbuild\n"; exit 0'
  run_ci_watch github 5
  assert_success
  run cat "$BATS_TEST_TMPDIR/gh-args"
  assert_output --partial "pr checks 5 --json name,bucket"
}

@test "ci-watch: github red when a real check fails (gh exits 1)" {
  make_stub gh 'printf "pass\tbuild\nfail\ttest\n"; exit 1'
  run_ci_watch github 5
  assert_failure 1
}

@test "ci-watch: github red on a cancelled real check (gh exits 1)" {
  make_stub gh 'printf "pass\tbuild\ncancel\ttest\n"; exit 1'
  run_ci_watch github 5
  assert_failure 1
}

@test "ci-watch: github ignores pending coderabbit check (gh exits 8)" {
  make_stub gh 'printf "pass\tbuild\npending\tCodeRabbit\n"; exit 8'
  run_ci_watch github 5
  assert_success
  assert_output --partial "coderabbit"
}

@test "ci-watch: github ignores failing coderabbit check (gh exits 1)" {
  make_stub gh 'printf "pass\tbuild\nfail\tcoderabbitai Review\n"; exit 1'
  run_ci_watch github 5
  assert_success
  assert_output --partial "coderabbit"
}

@test "ci-watch: github green when only coderabbit checks exist" {
  make_stub gh 'printf "pending\tCodeRabbit\n"; exit 8'
  run_ci_watch github 5
  assert_success
  assert_output --partial "coderabbit"
}

@test "ci-watch: github excludes any check whose name contains coderabbit" {
  # documented name-substring heuristic: even a failing check named
  # *coderabbit* cannot gate the result (it is excluded, with a note)
  make_stub gh 'printf "fail\tcoderabbit-config-lint\npass\tbuild\n"; exit 1'
  run_ci_watch github 5
  assert_success
  assert_output --partial "coderabbit"
}

@test "ci-watch: github waits for a pending real check, then green" {
  make_stub gh 'f="$STATE_DIR/gh-calls"; n=$(cat "$f" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$f"' \
    'if [ "$n" -lt 2 ]; then printf "pending\tbuild\n"; exit 8; else printf "pass\tbuild\n"; exit 0; fi'
  run_ci_watch github 5
  assert_success
}

@test "ci-watch: github exit 2 when real checks stay pending (deadline)" {
  make_stub gh 'printf "pending\tbuild\n"; exit 8'
  run_ci_watch github 5
  assert_failure 2
  assert_output --partial "timeout"
}

@test "ci-watch: github green with note when no checks are reported" {
  make_stub gh 'echo "no checks reported on the feature branch" >&2; exit 1'
  run_ci_watch github 5
  assert_success
  assert_output --partial "no checks"
}

@test "ci-watch: github exit 2 on persistent API errors" {
  make_stub gh 'echo "HTTP 504 Gateway Timeout" >&2; exit 1'
  run_ci_watch github 5
  assert_failure 2
}

@test "ci-watch: github exit 64 when gh lacks --json support" {
  make_stub gh 'echo "unknown flag: --json" >&2; exit 1'
  run_ci_watch github 5
  assert_failure 64
  assert_output --partial "too old"
}

@test "ci-watch: gitlab green on pipeline success (json output)" {
  make_stub glab 'printf "{\"id\": 7, \"status\": \"success\"}\n"; exit 0'
  run_ci_watch gitlab feature-branch
  assert_success
}

@test "ci-watch: gitlab red on pipeline failure (json output)" {
  make_stub glab 'printf "{\"id\": 7, \"status\": \"failed\"}\n"; exit 0'
  run_ci_watch gitlab feature-branch
  assert_failure 1
}

@test "ci-watch: gitlab text fallback parses tab-separated status" {
  # old glab: --output json is rejected, text output separates with a TAB
  make_stub glab 'case "$*" in *--output*) echo "unknown flag: --output" >&2; exit 1;; esac' \
    'printf "id:\t7\nstatus:\tsuccess\n"; exit 0'
  run_ci_watch gitlab feature-branch
  assert_success
}

@test "ci-watch: gitlab waits while running, then green" {
  make_stub glab 'f="$STATE_DIR/glab-calls"; n=$(cat "$f" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$f"' \
    'if [ "$n" -lt 2 ]; then printf "{\"status\": \"running\"}\n"; else printf "{\"status\": \"success\"}\n"; fi'
  run_ci_watch gitlab feature-branch
  assert_success
}

@test "ci-watch: gitlab skipped pipeline counts green with note" {
  make_stub glab 'printf "{\"status\": \"skipped\"}\n"; exit 0'
  run_ci_watch gitlab feature-branch
  assert_success
  assert_output --partial "skipped"
}

@test "ci-watch: gitlab manual gate counts green with note" {
  make_stub glab 'printf "{\"status\": \"manual\"}\n"; exit 0'
  run_ci_watch gitlab feature-branch
  assert_success
  assert_output --partial "manual"
}

@test "ci-watch: gitlab green with note when no pipeline exists" {
  make_stub glab 'echo "No pipelines running or available on branch: feature-branch" >&2; exit 1'
  run_ci_watch gitlab feature-branch
  assert_success
  assert_output --partial "no pipeline"
}
