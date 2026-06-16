#!/usr/bin/env bats
# Tests for branch-management's standalone bin/ scripts and manifest. The
# codex, coderabbit and graphify reviews are inlined into their agents and
# carry no bats coverage (dev-time self-test only). Covered here:
# copilot-review.sh, git-shim, clean-branches.sh, ci-watch.sh, the plugin.json
# userConfig manifest, and the review-branch rate-limit regex contract.
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
  SCRIPTS="$REPO_ROOT/plugins/branch-management/bin"

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
  rm -f "$MOCKBIN/$name"
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
# review-branch rate-limit regex contract
#
# The reviewer quota-record logic now lives inline in
# skills/review-branch/SKILL.md (no standalone quota script). The contract that
# used to be covered by the old quota record tests is preserved here by extracting
# the live regex from the skill and running the same corpus through it, so the
# test tracks the real regex instead of a drifting copy.

# regex_match <text> — exit 0 if the live review-branch rate-limit regex
# matches <text>, exit 1 otherwise. The regex is pulled verbatim from the
# `grep -qiE '…'` line in review-branch/SKILL.md.
RB_SKILL="$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/review-branch/SKILL.md"
regex_match() {
  local re
  re=$(grep -oE "grep -qiE '[^']*'" "$RB_SKILL" | head -n1 | sed -E "s/^grep -qiE '//; s/'$//")
  [ -n "$re" ] || return 2   # regex not found → fail loudly
  printf '%s' "$1" | grep -qiE "$re"
}

@test "rate-limit regex: extracted from review-branch SKILL.md" {
  re=$(grep -oE "grep -qiE '[^']*'" "$RB_SKILL" | head -n1 | sed -E "s/^grep -qiE '//; s/'$//")
  [ -n "$re" ]
}

@test "rate-limit regex: matches 'rate limit'" {
  regex_match "rate limit exceeded"
}

@test "rate-limit regex: matches 'free tier quota'" {
  regex_match "free tier quota exceeded"
}

@test "rate-limit regex: matches 'reviews/hour'" {
  regex_match "only 3 reviews/hour allowed"
}

@test "rate-limit regex: matches 'HTTP 429'" {
  regex_match "HTTP 429: too many requests"
}

@test "rate-limit regex: does NOT match an unrelated error" {
  ! regex_match "some other error occurred"
}

@test "rate-limit regex: does NOT match a bare disk-quota error" {
  ! regex_match "disk quota exceeded on runner"
}

@test "rate-limit regex: does NOT match 429 outside an HTTP context" {
  ! regex_match "build failed with code 429 artifacts"
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
  assert_output "3.9.0"
  run jq -e '.plugins[] | select(.name == "branch-management") | has("version") | not' \
    "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "dependencies: plugin.json declares none (context-mode is optional)" {
  run jq -e 'has("dependencies") | not' "$REPO_ROOT/$PLUGIN_JSON_REL"
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

@test "ctx-index-agent has effort: low" {
  grep -q '^effort: low' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/ctx-index-agent.md"
}

# --- init-branch skill ---

@test "init-branch SKILL.md exists" {
  [ -f "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/init-branch/SKILL.md" ]
}

@test "init-branch runs inline (NOT context: fork — it dispatches agents, must stay at depth 0)" {
  run grep '^context: fork' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/init-branch/SKILL.md"
  assert_failure
}

@test "init-branch does not pin a model (runs inline)" {
  run grep '^model:' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/init-branch/SKILL.md"
  assert_failure
}

@test "init-branch allowed-tools includes Agent" {
  grep -q 'allowed-tools:.*Agent' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/init-branch/SKILL.md"
}

@test "init-branch is user-invocable (no user-invocable: false)" {
  run grep '^user-invocable: false' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/init-branch/SKILL.md"
  assert_failure
}

@test "new-branch allowed-tools includes Skill (invokes init-branch)" {
  grep -q 'allowed-tools:.*Skill' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/new-branch/SKILL.md"
}

# --- review-branch skill ---

@test "review-branch SKILL.md exists" {
  [ -f "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/review-branch/SKILL.md" ]
}

@test "review-branch runs inline (NOT context: fork — a forked skill is a subagent and cannot dispatch the reviewers)" {
  run grep '^context: fork' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/review-branch/SKILL.md"
  assert_failure
}

@test "review-branch does not pin a model (runs inline)" {
  run grep '^model:' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/review-branch/SKILL.md"
  assert_failure
}

# --- configure-branch-management skill ---

CONFIGURE_SKILL="$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/configure-branch-management/SKILL.md"

@test "configure-branch-management SKILL.md exists" {
  [ -f "$CONFIGURE_SKILL" ]
}

@test "configure-branch-management has name: configure-branch-management" {
  grep -q '^name: configure-branch-management' "$CONFIGURE_SKILL"
}

@test "configure-branch-management allowed-tools includes AskUserQuestion" {
  grep -q 'AskUserQuestion' "$CONFIGURE_SKILL"
}

@test "configure-branch-management allowed-tools includes Bash(jq:*)" {
  grep -q 'Bash(jq:\*)' "$CONFIGURE_SKILL"
}

@test "configure-branch-management is not a sub-skill (no context: fork)" {
  run grep '^context: fork' "$CONFIGURE_SKILL"
  assert_failure
}

@test "configure-branch-management does not pin a model" {
  run grep '^model:' "$CONFIGURE_SKILL"
  assert_failure
}

@test "configure-branch-management has argument-hint frontmatter" {
  grep -q '^argument-hint:' "$CONFIGURE_SKILL"
}

# ── Helpers for clean-branches.sh ──────────────────────────────────────────

# make_clean_repo — create a bare "remote" + clone with topology:
#   - origin/HEAD → main  (set via remote set-head)
#   - feat/merged-remote: pushed to remote, merged into main on remote, local branch deleted
#   - feat/gone-local: pushed then remote-deleted → local with ': gone]' tracking
#   - one uncommitted modification on main
#   - real git symlinked into $MOCKBIN so all clean tests have it by default
make_clean_repo() {
    REMOTE_DIR="$BATS_TEST_TMPDIR/remote.git"
    REPO_DIR="$BATS_TEST_TMPDIR/repo"

    git init --bare "$REMOTE_DIR"

    git clone "$REMOTE_DIR" "$REPO_DIR"
    git -C "$REPO_DIR" config user.email "test@test.com"
    git -C "$REPO_DIR" config user.name "Test"

    # initial commit on main (branch -M main: rename master→main for systems
    # where init.defaultBranch is not configured to main)
    echo "init" > "$REPO_DIR/file.txt"
    git -C "$REPO_DIR" add file.txt
    git -C "$REPO_DIR" commit -m "init"
    git -C "$REPO_DIR" branch -M main
    git -C "$REPO_DIR" push -u origin main

    # set origin/HEAD on remote + sync to clone
    git -C "$REMOTE_DIR" symbolic-ref HEAD refs/heads/main
    git -C "$REPO_DIR" remote set-head origin -a

    # feat/merged-remote: pushed + merged into main on remote; local tracking deleted
    git -C "$REPO_DIR" checkout -b feat/merged-remote
    echo "feature" > "$REPO_DIR/feature.txt"
    git -C "$REPO_DIR" add feature.txt
    git -C "$REPO_DIR" commit -m "feature"
    git -C "$REPO_DIR" push -u origin feat/merged-remote
    git -C "$REPO_DIR" checkout main
    git -C "$REPO_DIR" merge --no-ff feat/merged-remote -m "Merge feat/merged-remote"
    git -C "$REPO_DIR" push origin main
    git -C "$REPO_DIR" branch -D feat/merged-remote

    # feat/gone-local: pushed then remote branch deleted → local ': gone]' after prune
    git -C "$REPO_DIR" checkout -b feat/gone-local
    echo "gone" > "$REPO_DIR/gone.txt"
    git -C "$REPO_DIR" add gone.txt
    git -C "$REPO_DIR" commit -m "gone"
    git -C "$REPO_DIR" push -u origin feat/gone-local
    git -C "$REPO_DIR" checkout main
    git -C "$REMOTE_DIR" branch -D feat/gone-local
    git -C "$REPO_DIR" fetch --prune

    # uncommitted change
    echo "dirty" >> "$REPO_DIR/file.txt"

    # provision real git into $MOCKBIN (tests that intercept override via make_stub git)
    ln -sf "$(command -v git)" "$MOCKBIN/git"

    CLEAN_SCRIPT="$REPO_ROOT/plugins/branch-management/bin/clean-branches.sh"
}

run_clean_script() {
    run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$CLEAN_SCRIPT" "$@"
}

#
# clean-branches.sh
#

@test "clean: git fetch --prune is called" {
    make_clean_repo
    cd "$REPO_DIR"
    make_stub git \
        '[ "$1" = "fetch" ] && [ "$2" = "--prune" ] && echo "FETCH_CALLED" && exit 0' \
        'exec "'"$(command -v git)"'" "$@"'
    run_clean_script
    assert_success
    assert_output --partial "FETCH_CALLED"
}

@test "clean: no gh/glab → upstream deletion skipped silently" {
    make_clean_repo
    cd "$REPO_DIR"
    run_clean_script
    assert_success
    refute_output --partial "Deleted upstream"
}

@test "clean: gh present + logged in → deletes merged upstream branch" {
    make_clean_repo
    cd "$REPO_DIR"
    make_stub gh 'if [ "$1" = "auth" ]; then exit 0; fi; exit 0'
    run_clean_script
    assert_success
    assert_output --partial "Deleted upstream branches:"
    assert_output --partial "feat/merged-remote"
}

@test "clean: default branch survives upstream pruning while a merged same-prefix branch is deleted" {
    # Regression guard for exact-name exclusion (commit 8a33272): origin/main
    # must never be push-deleted, but a merged branch sharing the prefix
    # (origin/main-backup) must be. Substring matching wrongly spared it.
    make_clean_repo
    cd "$REPO_DIR"
    # main-backup: branched from main (already merged into main), pushed.
    git -C "$REPO_DIR" checkout -b main-backup
    git -C "$REPO_DIR" push -u origin main-backup
    git -C "$REPO_DIR" checkout main
    make_stub gh 'if [ "$1" = "auth" ]; then exit 0; fi; exit 0'
    run_clean_script
    assert_success
    assert_output --partial "Deleted upstream branches:"
    assert_output --partial "main-backup"
    # main-backup is gone from the remote; main still exists on the remote.
    run git -C "$REMOTE_DIR" show-ref --verify --quiet refs/heads/main-backup
    assert_failure
    run git -C "$REMOTE_DIR" show-ref --verify --quiet refs/heads/main
    assert_success
}

@test "clean: gh not logged in → upstream deletion skipped silently" {
    make_clean_repo
    cd "$REPO_DIR"
    make_stub gh 'if [ "$1" = "auth" ]; then exit 1; fi; exit 0'
    run_clean_script
    assert_success
    refute_output --partial "Deleted upstream"
}

@test "clean: glab present + logged in → deletes merged upstream branch" {
    make_clean_repo
    cd "$REPO_DIR"
    make_stub glab 'if [ "$1" = "auth" ]; then exit 0; fi; exit 0'
    run_clean_script
    assert_success
    assert_output --partial "Deleted upstream branches:"
    assert_output --partial "feat/merged-remote"
}

@test "clean: local branch with gone tracking and unmerged commits is force-deleted under its own header" {
    # feat/gone-local carries an unmerged commit, so -d refuses it and the
    # script falls back to -D — reported separately so the loss is visible.
    make_clean_repo
    cd "$REPO_DIR"
    run_clean_script
    assert_success
    assert_output --partial "Force-deleted (had unmerged commits):"
    assert_output --partial "feat/gone-local"
    refute_output --partial "Deleted local branches (upstream gone):"
}

@test "clean: merged local branch with gone tracking is deleted safely under the merged header" {
    # feat/gone-merged is merged into main, so -d succeeds and it appears
    # under the safe-delete header, never the force-deleted one.
    make_clean_repo
    cd "$REPO_DIR"
    git -C "$REPO_DIR" checkout -b feat/gone-merged
    echo "merged" > "$REPO_DIR/merged.txt"
    git -C "$REPO_DIR" add merged.txt
    git -C "$REPO_DIR" commit -m "merged work"
    git -C "$REPO_DIR" push -u origin feat/gone-merged
    git -C "$REPO_DIR" checkout main
    git -C "$REPO_DIR" merge --no-ff feat/gone-merged -m "Merge feat/gone-merged"
    git -C "$REMOTE_DIR" branch -D feat/gone-merged
    git -C "$REPO_DIR" fetch --prune
    run_clean_script
    assert_success
    assert_output --partial "Deleted local branches (upstream gone):"
    assert_output --partial "feat/gone-merged"
}

@test "clean: no gone local branches → no local deletion output" {
    make_clean_repo
    cd "$REPO_DIR"
    git -C "$REPO_DIR" branch -D feat/gone-local 2>/dev/null || true
    run_clean_script
    assert_success
    refute_output --partial "Deleted local branches"
}

@test "clean: uncommitted files are listed" {
    make_clean_repo
    cd "$REPO_DIR"
    run_clean_script
    assert_success
    assert_output --partial "Uncommitted files:"
    assert_output --partial "file.txt"
}

@test "clean: no uncommitted files → no uncommitted output" {
    make_clean_repo
    cd "$REPO_DIR"
    git -C "$REPO_DIR" add file.txt
    git -C "$REPO_DIR" commit -m "clean up"
    run_clean_script
    assert_success
    refute_output --partial "Uncommitted files"
}

@test "clean: current branch with gone tracking is not deleted" {
    make_clean_repo
    cd "$REPO_DIR"
    git -C "$REPO_DIR" checkout feat/gone-local
    run_clean_script
    assert_success
    refute_output --partial "feat/gone-local"
}

# --- subagent-tracking rule ---

@test "subagent-tracking rule exists, carries the canonical block + inoculation note" {
  RULE="$REPO_ROOT/.claude/rules/subagent-tracking.md"
  [ -f "$RULE" ]
  run grep -qi 'Subagent reconciliation gate' "$RULE"
  assert_success
  run grep -qi 'inoculation' "$RULE"
  assert_success
  run grep -q 'select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop' "$RULE"
  assert_success
}

# --- init-branch subagent tracking ---
INIT_SKILL="$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/init-branch/SKILL.md"

@test "init-branch allowed-tools includes the Task* ledger tools and ToolSearch" {
  line=$(grep '^allowed-tools:' "$INIT_SKILL")
  for t in TaskCreate TaskUpdate TaskList TaskGet TaskStop ToolSearch; do
    echo "$line" | grep -q "$t" || { echo "missing $t in init-branch allowed-tools"; return 1; }
  done
}

@test "init-branch carries the subagent reconciliation gate" {
  run grep -q 'select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop' "$INIT_SKILL"
  assert_success
  run grep -qi 'Subagent reconciliation gate' "$INIT_SKILL"
  assert_success
}

# --- review-branch subagent tracking ---
RB_SKILL2="$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/review-branch/SKILL.md"

@test "review-branch allowed-tools includes the Task* ledger tools and ToolSearch" {
  line=$(grep '^allowed-tools:' "$RB_SKILL2")
  for t in TaskCreate TaskUpdate TaskList TaskGet TaskStop ToolSearch; do
    echo "$line" | grep -q "$t" || { echo "missing $t in review-branch allowed-tools"; return 1; }
  done
}

@test "review-branch carries the subagent reconciliation gate" {
  run grep -q 'select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop' "$RB_SKILL2"
  assert_success
  run grep -qi 'Subagent reconciliation gate' "$RB_SKILL2"
  assert_success
}

@test "review-branch gate appears before the DONE/BLOCKED token section (no DONE on an unreconciled batch)" {
  gate=$(grep -n 'select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop' "$RB_SKILL2" | head -n1 | cut -d: -f1)
  tok=$(grep -n 'terminal-state token' "$RB_SKILL2" | head -n1 | cut -d: -f1)
  [ -n "$gate" ] || { echo "gate line not found"; return 1; }
  [ -n "$tok" ]  || { echo "token line not found"; return 1; }
  [ "$gate" -lt "$tok" ] || { echo "gate ($gate) must precede DONE/BLOCKED token ($tok)"; return 1; }
}

# --- new-branch subagent tracking ---
NB_SKILL="$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/new-branch/SKILL.md"

@test "new-branch allowed-tools includes the Task* ledger tools and ToolSearch" {
  line=$(grep '^allowed-tools:' "$NB_SKILL")
  for t in TaskCreate TaskUpdate TaskList TaskGet TaskStop ToolSearch; do
    echo "$line" | grep -q "$t" || { echo "missing $t in new-branch allowed-tools"; return 1; }
  done
}

@test "new-branch carries the subagent reconciliation gate" {
  run grep -q 'select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop' "$NB_SKILL"
  assert_success
  run grep -qi 'Subagent reconciliation gate' "$NB_SKILL"
  assert_success
}
