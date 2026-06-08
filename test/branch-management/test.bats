#!/usr/bin/env bats
# Tests for branch-management: the three CLI review scripts
# (codex-review.sh, copilot-review.sh, coderabbit-review.sh),
# graphify-update.sh, quota-state.sh, the plugin.json userConfig manifest and
# the ci-watch.sh CI poller.
#
# Strategy: each script test runs with an isolated PATH that contains only
# symlinks to the required system tools plus per-test stub binaries for the
# reviewed CLI. Review-script exit-code contract: 0 review ran · 2 CLI
# missing · 3 not logged in · 4 run failed.
# ci-watch.sh: 0 green · 1 red · 2 deadline · 64 usage/environment; stubs
# mirror real gh/glab exit codes and output formats.

setup() {
  bats_require_minimum_version 1.5.0   # `run -N` exit-code checks
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

# run_script <script-name> [args...] — run a plugin script on the isolated
# PATH with a scrubbed environment (the common case; tests that need extra
# env vars keep the explicit env -i form).
run_script() {
  local script="$1"; shift
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$SCRIPTS/$script" "$@"
}

# Stub body shared by the coderabbit happy-path tests: logged in + working review.
CODERABBIT_OK_STUB='if [ "$1" = "auth" ]; then echo "Logged in as tester"; exit 0; fi
if [ "$1" = "review" ]; then echo "CODERABBIT REVIEW OUTPUT $*"; exit 0; fi
exit 64'

#
# codex-review.sh
#

@test "codex: exit 2 when CLI is missing" {
  run_script codex-review.sh main
  assert_failure 2
}

@test "codex: exit 3 when not logged in" {
  make_stub codex 'if [ "$1" = "login" ]; then [ "$2" = "status" ] || exit 99; exit 1; fi' 'exit 0'
  run_script codex-review.sh main
  assert_failure 3
}

@test "codex: passes review output through and targets origin/<base>" {
  make_stub codex \
    'if [ "$1" = "login" ]; then [ "$2" = "status" ] || exit 99; exit 0; fi' \
    'if [ "$1" = "exec" ]; then echo "CODEX REVIEW OUTPUT $*"; exit 0; fi' \
    'exit 64'
  run_script codex-review.sh main
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
  run_script codex-review.sh main
  assert_failure 4
}

@test "codex: usage error without base argument" {
  make_stub codex 'exit 0'
  run_script codex-review.sh
  assert_failure 1
  assert_output --partial "usage"
}

#
# copilot-review.sh
#

@test "copilot: exit 2 when CLI is missing" {
  run_script copilot-review.sh main
  assert_failure 2
}

@test "copilot: exit 3 when no token env and no login state" {
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  run_script copilot-review.sh main
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

@test "copilot: recorded login in config.json satisfies the login heuristic" {
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  mkdir -p "$HOME/.copilot"
  printf '%s\n' '{' '  "loggedInUsers": [' '    {' \
    '      "host": "https://github.com",' '      "login": "tester"' \
    '    }' '  ]' '}' > "$HOME/.copilot/config.json"
  run_script copilot-review.sh main
  assert_success
}

@test "copilot: COPILOT_HOME override with recorded login satisfies the heuristic" {
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  mkdir -p "$BATS_TEST_TMPDIR/cphome"
  printf '{"loggedInUsers":[{"login":"tester"}]}' \
    > "$BATS_TEST_TMPDIR/cphome/config.json"
  run env -i PATH="$MOCKBIN" HOME="$HOME" COPILOT_HOME="$BATS_TEST_TMPDIR/cphome" \
    bash "$SCRIPTS/copilot-review.sh" main
  assert_success
}

@test "copilot: bare ~/.copilot directory no longer satisfies the heuristic" {
  # A fresh COPILOT_HOME is created on first launch without any login.
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  mkdir -p "$HOME/.copilot"
  run_script copilot-review.sh main
  assert_failure 3
}

@test "copilot: first-launch config.json without login maps to exit 3" {
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  mkdir -p "$HOME/.copilot"
  printf '{"firstLaunchAt":"2026-01-01T00:00:00.000Z"}' \
    > "$HOME/.copilot/config.json"
  run_script copilot-review.sh main
  assert_failure 3
}

@test "copilot: logged-out config.json (empty loggedInUsers) maps to exit 3" {
  # Minified on purpose: lastLoggedInUser.login on the same line must not
  # fake a match for the non-empty loggedInUsers check.
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  mkdir -p "$HOME/.copilot"
  printf '{"lastLoggedInUser":{"login":"tester"},"loggedInUsers":[]}' \
    > "$HOME/.copilot/config.json"
  run_script copilot-review.sh main
  assert_failure 3
}

@test "copilot: gh keyring login (no token in hosts.yml) satisfies the heuristic" {
  # gh's default secure storage keeps the token in the OS keyring, so a
  # logged-in hosts.yml carries a user but NO oauth_token line.
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  mkdir -p "$HOME/.config/gh"
  printf '%s\n' 'github.com:' '    user: tester' '    git_protocol: https' \
    > "$HOME/.config/gh/hosts.yml"
  run_script copilot-review.sh main
  assert_success
}

@test "copilot: gh insecure-storage login (inline token) satisfies the heuristic" {
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  mkdir -p "$HOME/.config/gh"
  printf '%s\n' 'github.com:' '    user: tester' '    oauth_token: gho_x' \
    > "$HOME/.config/gh/hosts.yml"
  run_script copilot-review.sh main
  assert_success
}

@test "copilot: gh config honours GH_CONFIG_DIR" {
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  mkdir -p "$BATS_TEST_TMPDIR/ghcfg"
  printf '%s\n' 'github.com:' '    user: tester' \
    > "$BATS_TEST_TMPDIR/ghcfg/hosts.yml"
  run env -i PATH="$MOCKBIN" HOME="$HOME" GH_CONFIG_DIR="$BATS_TEST_TMPDIR/ghcfg" \
    bash "$SCRIPTS/copilot-review.sh" main
  assert_success
}

@test "copilot: logged-out gh hosts.yml (no user) maps to exit 3" {
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT"; exit 0'
  mkdir -p "$HOME/.config/gh"
  printf '%s\n' 'github.com:' '    git_protocol: https' \
    > "$HOME/.config/gh/hosts.yml"
  run_script copilot-review.sh main
  assert_failure 3
}

@test "copilot: review run is hardened read-only" {
  # The stub echoes $*, so the full flag line (every --allow-tool) is asserted.
  make_stub copilot 'echo "COPILOT REVIEW OUTPUT $*"; exit 0'
  run env -i PATH="$MOCKBIN" HOME="$HOME" GH_TOKEN=x \
    bash "$SCRIPTS/copilot-review.sh" main
  assert_success
  assert_output --partial "deny-tool write"      # write tool must be denied
  assert_output --partial "shell(git diff)"      # read-only git allowlist present
  refute_output --partial "shell(git:*)"         # blanket git allow is gone
  # No write-capable git subcommand may be allowlisted — copilot approves on a
  # subcommand basis, so any of these would auto-approve a repo mutation.
  refute_output --partial "shell(git branch)"
  refute_output --partial "shell(git commit)"
  refute_output --partial "shell(git push)"
  refute_output --partial "shell(git checkout)"
  refute_output --partial "shell(git restore)"
  refute_output --partial "shell(git reset)"
  refute_output --partial "shell(git stash)"
  refute_output --partial "shell(git config)"
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
  run_script copilot-review.sh
  assert_failure 1
  assert_output --partial "usage"
}

#
# git-shim/git — read-only git facade prepended to copilot's PATH so even the
# allowlisted read-only subcommands cannot write via the --output/-O flag
# family (which copilot's per-subcommand allowlist cannot express).
#

# Drop a fake "real git" that echoes its args, so passthrough is observable
# and a refusal is provable by the ABSENCE of that echo.
fake_real_git() {
  printf '%s\n' '#!/usr/bin/env bash' 'printf "REALGIT %s\n" "$*"' > "$1"
  chmod +x "$1"
}

@test "git-shim: forwards a read-only invocation to the real git" {
  fake_real_git "$BATS_TEST_TMPDIR/realgit"
  run env COPILOT_REVIEW_REAL_GIT="$BATS_TEST_TMPDIR/realgit" \
    "$SCRIPTS/git-shim/git" --no-pager diff origin/main...HEAD
  assert_success
  assert_output "REALGIT --no-pager diff origin/main...HEAD"
}

@test "git-shim: refuses git diff --output (arbitrary file write)" {
  fake_real_git "$BATS_TEST_TMPDIR/realgit"
  run env COPILOT_REVIEW_REAL_GIT="$BATS_TEST_TMPDIR/realgit" \
    "$SCRIPTS/git-shim/git" diff --output=/tmp/pwned HEAD~1 HEAD
  assert_failure 13
  refute_output --partial "REALGIT"
}

@test "git-shim: refuses the short -o output flag" {
  fake_real_git "$BATS_TEST_TMPDIR/realgit"
  run env COPILOT_REVIEW_REAL_GIT="$BATS_TEST_TMPDIR/realgit" \
    "$SCRIPTS/git-shim/git" diff -o /tmp/pwned
  assert_failure 13
  refute_output --partial "REALGIT"
}

@test "git-shim: refuses git grep -O (spawns a pager command)" {
  fake_real_git "$BATS_TEST_TMPDIR/realgit"
  run env COPILOT_REVIEW_REAL_GIT="$BATS_TEST_TMPDIR/realgit" \
    "$SCRIPTS/git-shim/git" grep -Ovim pattern
  assert_failure 13
  refute_output --partial "REALGIT"
}

@test "git-shim: refuses --output-directory" {
  fake_real_git "$BATS_TEST_TMPDIR/realgit"
  run env COPILOT_REVIEW_REAL_GIT="$BATS_TEST_TMPDIR/realgit" \
    "$SCRIPTS/git-shim/git" format-patch --output-directory=/tmp/x HEAD~1
  assert_failure 13
  refute_output --partial "REALGIT"
}

@test "git-shim: exits 127 when the real git path is not provided" {
  run -127 env -u COPILOT_REVIEW_REAL_GIT "$SCRIPTS/git-shim/git" status
  assert_output --partial "COPILOT_REVIEW_REAL_GIT"
}

#
# coderabbit-review.sh
#

@test "coderabbit: exit 2 when neither coderabbit nor cr is installed" {
  run_script coderabbit-review.sh main
  assert_failure 2
}

@test "coderabbit: exit 3 when not logged in" {
  make_stub coderabbit 'if [ "$1" = "auth" ]; then echo "Not logged in"; exit 0; fi'
  run_script coderabbit-review.sh main
  assert_failure 3
}

@test "coderabbit: unrecognizable auth output maps to exit 3" {
  make_stub coderabbit 'if [ "$1" = "auth" ]; then echo "???"; exit 0; fi'
  run_script coderabbit-review.sh main
  assert_failure 3
}

@test "coderabbit: 'Not currently authenticated' wording maps to exit 3" {
  make_stub coderabbit 'if [ "$1" = "auth" ]; then echo "Not currently authenticated to CodeRabbit"; exit 0; fi'
  run_script coderabbit-review.sh main
  assert_failure 3
}

@test "coderabbit: 'no longer logged in' wording maps to exit 3" {
  make_stub coderabbit 'if [ "$1" = "auth" ]; then echo "Session expired. You are no longer logged in"; exit 0; fi'
  run_script coderabbit-review.sh main
  assert_failure 3
}

@test "coderabbit: 'Authenticated' wording satisfies the login check" {
  make_stub coderabbit 'if [ "$1" = "auth" ]; then echo "Authenticated as tester"; exit 0; fi
if [ "$1" = "review" ]; then echo "CODERABBIT REVIEW OUTPUT"; exit 0; fi
exit 64'
  run_script coderabbit-review.sh main
  assert_success
}

@test "coderabbit: passes review output through with --prompt-only and --base" {
  make_stub coderabbit "$CODERABBIT_OK_STUB"
  run_script coderabbit-review.sh main
  assert_success
  assert_output --partial "CODERABBIT REVIEW OUTPUT"
  assert_output --partial "--prompt-only"
  assert_output --partial "--base main"
}

@test "coderabbit: cr alias is found when coderabbit is absent" {
  make_stub cr "$CODERABBIT_OK_STUB"
  run_script coderabbit-review.sh main
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
  run_script coderabbit-review.sh
  assert_failure 1
  assert_output --partial "usage"
}

#
# graphify-update.sh
#
# Exit-code contract: 0 update ran · 2 graphify CLI missing · 4 update run
# failed · 5 graphify-out/ missing without --force. The script resolves the
# repo root itself, so every test runs inside a throwaway git repo under
# $BATS_TEST_TMPDIR — never against the real repository.

# setup_graphify_repo — link the real git into MOCKBIN and create + enter a
# throwaway git repo so graphify-update.sh resolves its repo root inside the
# test sandbox.
setup_graphify_repo() {
  ln -sf "$(command -v git)" "$MOCKBIN/git"
  GRAPHIFY_REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$GRAPHIFY_REPO"
  cd "$GRAPHIFY_REPO"
  env -i PATH="$MOCKBIN" HOME="$HOME" git init -q
}

@test "graphify: exit 2 when CLI is missing" {
  setup_graphify_repo
  run_script graphify-update.sh
  assert_failure 2
}

@test "graphify: exit 5 when graphify-out is missing without --force" {
  setup_graphify_repo
  make_stub graphify 'echo "GRAPHIFY $*"; exit 0'
  run_script graphify-update.sh
  assert_failure 5
  [ ! -d "$GRAPHIFY_REPO/graphify-out" ]   # must not create the folder
}

@test "graphify: --force creates graphify-out and runs the update" {
  setup_graphify_repo
  make_stub graphify 'echo "GRAPHIFY $*"; exit 0'
  run_script graphify-update.sh --force
  assert_success
  assert_output --partial "GRAPHIFY update ."
  [ -d "$GRAPHIFY_REPO/graphify-out" ]
}

@test "graphify: runs the update when graphify-out exists" {
  setup_graphify_repo
  mkdir -p graphify-out
  make_stub graphify 'echo "GRAPHIFY $*"; exit 0'
  run_script graphify-update.sh
  assert_success
  assert_output --partial "GRAPHIFY update ."
}

@test "graphify: prunes human-only graph.html after the update" {
  setup_graphify_repo
  mkdir -p graphify-out
  make_stub graphify 'mkdir -p graphify-out; echo viz > graphify-out/graph.html; exit 0'
  run_script graphify-update.sh
  assert_success
  [ ! -f "$GRAPHIFY_REPO/graphify-out/graph.html" ]
}

@test "graphify: --keep-user-files keeps graph.html" {
  setup_graphify_repo
  mkdir -p graphify-out
  make_stub graphify 'mkdir -p graphify-out; echo viz > graphify-out/graph.html; exit 0'
  run_script graphify-update.sh --keep-user-files
  assert_success
  [ -f "$GRAPHIFY_REPO/graphify-out/graph.html" ]
}

@test "graphify: runs from the repository root regardless of cwd" {
  setup_graphify_repo
  mkdir -p graphify-out sub/dir
  make_stub graphify 'echo "GRAPHIFY pwd=$PWD"; exit 0'
  cd sub/dir
  run_script graphify-update.sh
  assert_success
  assert_output --partial "pwd=$GRAPHIFY_REPO"
}

@test "graphify: exit 4 when the update fails" {
  setup_graphify_repo
  mkdir -p graphify-out
  make_stub graphify 'echo boom >&2; exit 1'
  run_script graphify-update.sh
  assert_failure 4
}

@test "graphify: exit 4 when the update hangs (timeout)" {
  setup_graphify_repo
  mkdir -p graphify-out
  make_stub graphify 'sleep 5'
  run env -i PATH="$MOCKBIN" HOME="$HOME" GRAPHIFY_TIMEOUT=1 \
    bash "$SCRIPTS/graphify-update.sh"
  assert_failure 4
}

@test "graphify: usage error on unknown argument" {
  setup_graphify_repo
  make_stub graphify 'exit 0'
  run_script graphify-update.sh --bogus
  assert_failure 1
  assert_output --partial "usage"
}

#
# quota-state.sh
#
# check <tool>             -- exit 0: blocked (stdout: reset epoch); exit 1: clear
# record <tool> <error>    -- exit 0: quota file written; exit 1: no match
# format_time <epoch>      -- print HH:MM from epoch

@test "quota: check exits 1 when no quota file exists" {
  run bash "$SCRIPTS/quota-state.sh" check coderabbit
  assert_failure 1
}

@test "quota: check exits 0 and prints epoch when reset is in the future" {
  mkdir -p "$HOME/.claude/branch-management/quota"
  future=$(( $(date +%s) + 3600 ))
  echo "$future" > "$HOME/.claude/branch-management/quota/coderabbit.quota"
  run bash "$SCRIPTS/quota-state.sh" check coderabbit
  assert_success
  assert_output "$future"
}

@test "quota: check exits 1 and removes file when reset has passed" {
  mkdir -p "$HOME/.claude/branch-management/quota"
  past=$(( $(date +%s) - 1 ))
  echo "$past" > "$HOME/.claude/branch-management/quota/coderabbit.quota"
  run bash "$SCRIPTS/quota-state.sh" check coderabbit
  assert_failure 1
  [ ! -f "$HOME/.claude/branch-management/quota/coderabbit.quota" ]
}

@test "quota: record exits 0 and creates file on rate-limit error" {
  run bash "$SCRIPTS/quota-state.sh" record coderabbit "rate limit exceeded"
  assert_success
  [ -f "$HOME/.claude/branch-management/quota/coderabbit.quota" ]
}

@test "quota: record recognises quota keyword" {
  run bash "$SCRIPTS/quota-state.sh" record codex "free tier quota exceeded"
  assert_success
}

@test "quota: record recognises reviews/hour pattern" {
  run bash "$SCRIPTS/quota-state.sh" record coderabbit "only 3 reviews/hour allowed"
  assert_success
}

@test "quota: record recognises HTTP 429" {
  run bash "$SCRIPTS/quota-state.sh" record copilot "HTTP 429: too many requests"
  assert_success
}

@test "quota: record exits 1 on unrelated error" {
  run bash "$SCRIPTS/quota-state.sh" record coderabbit "some other error occurred"
  assert_failure 1
  [ ! -f "$HOME/.claude/branch-management/quota/coderabbit.quota" ]
}

@test "quota: record exits 1 on unrelated disk-quota error" {
  run bash "$SCRIPTS/quota-state.sh" record codex "disk quota exceeded on runner"
  assert_failure 1
  [ ! -f "$HOME/.claude/branch-management/quota/codex.quota" ]
}

@test "quota: record exits 1 when 429 appears outside an HTTP context" {
  run bash "$SCRIPTS/quota-state.sh" record codex "build failed with code 429 artifacts"
  assert_failure 1
  [ ! -f "$HOME/.claude/branch-management/quota/codex.quota" ]
}

@test "quota: format_time prints HH:MM for a valid epoch" {
  epoch=$(date +%s)
  run bash "$SCRIPTS/quota-state.sh" format_time "$epoch"
  assert_success
  [[ "$output" =~ ^[0-9]{2}:[0-9]{2}$ ]]
}

@test "quota: usage error on unknown command" {
  run bash "$SCRIPTS/quota-state.sh" bogus tool
  assert_failure 64
}

#
# plugin.json userConfig
#

PLUGIN_JSON_REL="plugins/branch-management/.claude-plugin/plugin.json"

@test "userConfig: declares expected toggles plus ci_watch_timeout and review_max_rounds" {
  run jq -r '.userConfig | keys | sort | join(" ")' "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
  assert_output "ci_monitor ci_watch_timeout coderabbit_ci_comments context_index graphify_branch_update graphify_force_create graphify_pr_commit graphify_pr_update graphify_user_files review_claude review_coderabbit review_codex review_copilot review_max_rounds"
}

@test "userConfig: every toggle except numeric ones is a boolean" {
  run jq -e '.userConfig
    | to_entries
    | map(select(.key != "ci_watch_timeout" and .key != "review_max_rounds"))
    | all(.[]; .value.type == "boolean")' \
    "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
}

@test "userConfig: boolean toggles default to true except the fail-closed ones" {
  run jq -e '.userConfig
    | to_entries
    | map(select(.key != "ci_watch_timeout" and .key != "review_max_rounds"))
    | all(.[]; .value.default == (if .key == "graphify_force_create" or .key == "graphify_user_files" then false else true end))' \
    "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
}

@test "userConfig: ci_watch_timeout is numeric with default 1800" {
  run jq -e '.userConfig.ci_watch_timeout
    | (.type == "number")
    and (.default == 1800)' \
    "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
}

@test "userConfig: review_max_rounds is numeric with default 3" {
  run jq -e '.userConfig.review_max_rounds
    | (.type == "number")
    and (.default == 3)' \
    "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
}

@test "userConfig: every toggle carries a non-empty title and description" {
  run jq -e '.userConfig | all(.[]; (.title | length > 0) and (.description | length > 0))' \
    "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
}

@test "userConfig: every boolean description documents values and default" {
  run jq -e '.userConfig
    | to_entries
    | map(select(.key != "ci_watch_timeout" and .key != "review_max_rounds"))
    | all(.[]; (.value.description | test("Values:")) and (.value.description | test("\\btrue\\b")) and (.value.description | test("\\bfalse\\b")) and (.value.description | test("Default: (true|false)\\.")))' \
    "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
}

@test "userConfig: ci_watch_timeout description documents numeric value and default" {
  run jq -e '.userConfig.ci_watch_timeout.description
    | test("positive whole-number seconds")
    and test("Default: 1800\\.")' \
    "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
}

@test "userConfig: review_max_rounds description documents numeric value and default" {
  run jq -e '.userConfig.review_max_rounds.description
    | test("positive whole-number")
    and test("Default: 3\\.")' \
    "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
}

@test "version: declared once — plugin.json only, marketplace entry carries none" {
  run jq -r '.version' "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_output "3.3.0"
  run jq -e '.plugins[] | select(.name == "branch-management") | has("version") | not' \
    "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "userConfig: no references to the removed settings implementation remain" {
  run grep -rn "review-settings" "$REPO_ROOT/plugins/branch-management"
  assert_failure 1
  # The README's v3 breaking-change note is the one allowed mention of the
  # old settings file; everywhere else it must be gone.
  run grep -rn --exclude=README.md "branch-management.local.md" \
    "$REPO_ROOT/plugins/branch-management"
  assert_failure 1
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

# --- effort: low assertions ---

@test "branch-agent has effort: low" {
  grep -q '^effort: low' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/branch-agent.md"
}

@test "graphify-agent has effort: low" {
  grep -q '^effort: low' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/graphify-agent.md"
}

@test "codex-reviewer has effort: low" {
  grep -q '^effort: low' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/codex-reviewer.md"
}

@test "copilot-reviewer has effort: low" {
  grep -q '^effort: low' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/copilot-reviewer.md"
}

@test "coderabbit-reviewer has effort: low" {
  grep -q '^effort: low' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/coderabbit-reviewer.md"
}

@test "ci-monitor has effort: low" {
  grep -q '^effort: low' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/ci-monitor.md"
}

# --- graphify-update skill ---

@test "graphify-update SKILL.md exists" {
  [ -f "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/graphify-update/SKILL.md" ]
}

@test "graphify-update has context: fork" {
  grep -q '^context: fork' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/graphify-update/SKILL.md"
}

@test "graphify-update has model: haiku" {
  grep -q '^model: haiku' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/graphify-update/SKILL.md"
}

@test "graphify-update has effort: low" {
  grep -q '^effort: low' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/graphify-update/SKILL.md"
}
