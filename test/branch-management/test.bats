#!/usr/bin/env bats
# Tests for branch-management's standalone bin/ scripts and manifest. The
# suite covers clean-branches.sh, ci-watch.sh, and the plugin.json
# userConfig manifest.
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
  # `rg` is NOT required (the loop below only symlinks tools actually present
  # on the host, so its absence is a silent no-op) -- but forwarding it when
  # present lets ci-watch.sh's own rg_or_grep() take its rg-preferred branch
  # under this suite too, instead of only ever exercising the grep fallback.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash env grep rg timeout sleep mktemp cat rm mkdir awk; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -s "$src" "$MOCKBIN/$t"
  done

  # Isolated HOME so ~/.copilot is under our control.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"
}

# Prefer ripgrep; fall back to grep if rg isn't installed. rg's -E means
# --encoding=ARG and -r means --replace=ARG (both take a value, neither is
# grep's meaning), and rg has no recursive flag (recursion is its
# default) — so a bundled/bare -E is stripped before delegating to rg
# (its regex syntax is already ERE-equivalent for every pattern used in
# this file); grep gets its original arguments completely untouched.
# Note: bare `rg -c` prints nothing on 0 matches where `grep -c` prints `0`
# (both exit 1) -- no call site here checks that text (only $status or a
# nonzero count), so this divergence is accepted rather than papered over
# with --include-zero, which errors on ripgrep < 12.0.0.
rg_or_grep() {
  if command -v rg >/dev/null 2>&1; then
    local args=() a stripped seen_dashdash=false
    for a in "$@"; do
      if [ "$seen_dashdash" = true ]; then
        args+=("$a")
        continue
      fi
      case "$a" in
        --) seen_dashdash=true; args+=("$a") ;;
        -[A-Za-z]*)
          stripped="${a//E/}"
          [ "$stripped" = "-" ] && continue
          args+=("$stripped")
          ;;
        *) args+=("$a") ;;
      esac
    done
    command rg "${args[@]}"
  else
    command grep "$@"
  fi
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
# plugin.json userConfig
#

PLUGIN_JSON_REL="plugins/branch-management/.claude-plugin/plugin.json"

@test "userConfig: declares expected toggles plus ci_watch_timeout and review_max_rounds" {
  run jq -r '.userConfig | keys | sort | join(" ")' "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
  assert_output "ci_monitor ci_watch_timeout coderabbit_ci_comments delete_branch_on_merge rebase_before_pr review_level review_max_rounds"
}

@test "userConfig: every toggle except numeric ones is a boolean" {
  run jq -e '.userConfig
    | to_entries
    | map(select(.key != "ci_watch_timeout" and .key != "review_max_rounds" and .key != "review_level"))
    | all(.[]; .value.type == "boolean")' \
    "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
}

@test "userConfig: every boolean toggle defaults to true" {
  run jq -e '.userConfig
    | to_entries
    | map(select(.key != "ci_watch_timeout" and .key != "review_max_rounds" and .key != "review_level"))
    | all(.[]; .value.default == true)' \
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
    | map(select(.key != "ci_watch_timeout" and .key != "review_max_rounds" and .key != "review_level"))
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

@test "userConfig: review_level is a string with default medium" {
  run jq -e '.userConfig.review_level
    | (.type == "string")
    and (.default == "medium")' \
    "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
}

@test "userConfig: review_level description documents valid values and default" {
  run jq -e '.userConfig.review_level.description
    | test("low")
    and test("medium")
    and test("high")
    and test("xhigh")
    and test("max")
    and test("Default: medium\\.")' \
    "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
}

@test "version: declared once — plugin.json only, marketplace entry carries none" {
  run jq -r '.version' "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_output "5.0.4"
  run jq -e '.plugins[] | select(.name == "branch-management") | has("version") | not' \
    "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "dependencies: plugin.json declares none (context-mode is optional)" {
  run jq -e 'has("dependencies") | not' "$REPO_ROOT/$PLUGIN_JSON_REL"
  assert_success
}

@test "userConfig: no references to the removed settings implementation remain" {
  local have_rg=false
  command -v rg >/dev/null 2>&1 && have_rg=true
  if [ "$have_rg" = true ]; then
    run rg -n --no-ignore --hidden -a "review-settings" "$REPO_ROOT/plugins/branch-management"
  else
    run grep -rn "review-settings" "$REPO_ROOT/plugins/branch-management"
  fi
  assert_failure 1
  # The README's v3 breaking-change note is the one allowed mention of the
  # old settings file; everywhere else it must be gone.
  if [ "$have_rg" = true ]; then
    run rg -n --no-ignore --hidden -a --glob '!README.md' "branch-management.local.md" \
      "$REPO_ROOT/plugins/branch-management"
  else
    run grep -rn --exclude=README.md "branch-management.local.md" \
      "$REPO_ROOT/plugins/branch-management"
  fi
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

@test "ci-monitor has effort: low" {
  rg_or_grep -q '^effort: low' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/ci-monitor.md"
}

# --- review-branch skill ---

@test "review-branch SKILL.md exists" {
  [ -f "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/review-branch/SKILL.md" ]
}

@test "review-branch runs inline (NOT context: fork — a forked skill is a subagent and cannot dispatch the reviewers)" {
  run rg_or_grep '^context: fork' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/review-branch/SKILL.md"
  assert_failure
}

@test "review-branch does not pin a model (runs inline)" {
  run rg_or_grep '^model:' \
    "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/review-branch/SKILL.md"
  assert_failure
}

# --- configure-branch-management skill ---

CONFIGURE_SKILL="$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/configure-branch-management/SKILL.md"

@test "configure-branch-management SKILL.md exists" {
  [ -f "$CONFIGURE_SKILL" ]
}

@test "configure-branch-management has name: configure-branch-management" {
  rg_or_grep -q '^name: configure-branch-management' "$CONFIGURE_SKILL"
}

@test "configure-branch-management allowed-tools includes AskUserQuestion" {
  rg_or_grep -q 'AskUserQuestion' "$CONFIGURE_SKILL"
}

@test "configure-branch-management allowed-tools includes Bash(jq:*)" {
  rg_or_grep -qF 'Bash(jq:*)' "$CONFIGURE_SKILL"
}

@test "configure-branch-management is not a sub-skill (no context: fork)" {
  run rg_or_grep '^context: fork' "$CONFIGURE_SKILL"
  assert_failure
}

@test "configure-branch-management does not pin a model" {
  run rg_or_grep '^model:' "$CONFIGURE_SKILL"
  assert_failure
}

@test "configure-branch-management has argument-hint frontmatter" {
  rg_or_grep -q '^argument-hint:' "$CONFIGURE_SKILL"
}

# --- clean-branches skill (runs inline — not a forked subagent) ---
CLEAN_BRANCHES_SKILL="$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/clean-branches/SKILL.md"

@test "clean-branches SKILL.md exists" {
  [ -f "$CLEAN_BRANCHES_SKILL" ]
}

@test "clean-branches runs inline (NOT context: fork)" {
  run rg_or_grep '^context: fork' "$CLEAN_BRANCHES_SKILL"
  assert_failure
}

@test "clean-branches does not pin a model (runs inline)" {
  run rg_or_grep '^model:' "$CLEAN_BRANCHES_SKILL"
  assert_failure
}

@test "clean-branches stays user-only (disable-model-invocation: true)" {
  rg_or_grep -q '^disable-model-invocation: true' "$CLEAN_BRANCHES_SKILL"
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
  run rg_or_grep -qi 'Subagent reconciliation gate' "$RULE"
  assert_success
  run rg_or_grep -qi 'inoculation' "$RULE"
  assert_success
  run rg_or_grep -q 'select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop' "$RULE"
  assert_success
}

# --- review-branch claude-reviewer + review-fixer dispatch ---
RB_SKILL2="$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/review-branch/SKILL.md"

@test "review-branch allowed-tools includes Agent (dispatches claude-reviewer and review-fixer)" {
  line=$(rg_or_grep '^allowed-tools:' "$RB_SKILL2")
  echo "$line" | rg_or_grep -q '"Agent"'
}

@test "review-branch allowed-tools includes Task* ledger tools (async dispatch tracking)" {
  line=$(rg_or_grep '^allowed-tools:' "$RB_SKILL2")
  for t in TaskCreate TaskUpdate TaskList TaskGet TaskStop ToolSearch; do
    echo "$line" | rg_or_grep -q "$t" || { echo "missing $t in review-branch allowed-tools"; return 1; }
  done
}

@test "review-branch allowed-tools excludes Skill (no sub-skill invocation)" {
  line=$(rg_or_grep '^allowed-tools:' "$RB_SKILL2")
  ! echo "$line" | rg_or_grep -qw '"Skill"'
}

@test "claude-reviewer agent file exists and declares name: claude-reviewer" {
  f="$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/claude-reviewer.md"
  [ -f "$f" ]
  rg_or_grep -q '^name: claude-reviewer$' "$f"
}

@test "ci-monitor agent has no context-mode reference" {
  run cat "$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/ci-monitor.md"
  assert_success
  refute_output --partial "context-mode"
}

@test "review-fixer agent has no context-mode reference" {
  run cat "$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/review-fixer.md"
  assert_success
  refute_output --partial "context-mode"
}

@test "claude-reviewer agent has no context-mode reference" {
  run cat "$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/claude-reviewer.md"
  assert_success
  refute_output --partial "context-mode"
}

# --- new-branch (branch creation inlined — no subagent dispatch) ---
NB_SKILL="$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/new-branch/SKILL.md"

@test "branch-agent agent is deleted (inlined into new-branch)" {
  [ ! -f "$BATS_TEST_DIRNAME/../../plugins/branch-management/agents/branch-agent.md" ]
}

@test "new-branch does not dispatch the branch-agent subagent" {
  rg_or_grep -q '^allowed-tools:' "$NB_SKILL"   # load-bearing: file + frontmatter present
  run rg_or_grep -q 'branch-management:branch-agent' "$NB_SKILL"
  assert_failure
}

@test "new-branch allowed-tools excludes Agent and the Task* ledger (no async dispatch)" {
  line=$(rg_or_grep '^allowed-tools:' "$NB_SKILL")
  [ -n "$line" ] || { echo "allowed-tools line missing in new-branch SKILL.md"; return 1; }
  for t in Agent TaskCreate TaskUpdate TaskList TaskGet TaskStop; do
    echo "$line" | rg_or_grep -q "$t" && { echo "unexpected $t in new-branch allowed-tools"; return 1; }
  done
  return 0
}

@test "new-branch allowed-tools includes Bash(bash:*) (runs the inline git script)" {
  line=$(rg_or_grep '^allowed-tools:' "$NB_SKILL")
  echo "$line" | rg_or_grep -qF 'Bash(bash:*)' || { echo "missing Bash(bash:*) in new-branch allowed-tools"; return 1; }
}

@test "new-branch cuts the branch with an inline git script (synchronous)" {
  rg_or_grep -q 'set -uo pipefail' "$NB_SKILL"
  rg_or_grep -q 'git checkout -b' "$NB_SKILL"
  rg_or_grep -q 'exit 6' "$NB_SKILL"
}

@test "init-branch skill is removed" {
  [ ! -e "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/init-branch" ]
}

@test "new-branch allowed-tools does NOT include Skill (no sub-skill invoked)" {
  line=$(rg_or_grep -m1 'allowed-tools' "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/new-branch/SKILL.md")
  ! echo "$line" | rg_or_grep -qw 'Skill'
}

@test "new-branch carries the inline worktree self-rebase" {
  rg_or_grep -q 'REBASE_RESULT=' "$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/new-branch/SKILL.md"
}

# --- new-pr subagent tracking ---
NPR_SKILL="$BATS_TEST_DIRNAME/../../plugins/branch-management/skills/new-pr/SKILL.md"

@test "new-pr allowed-tools includes the Task* ledger tools and ToolSearch" {
  line=$(rg_or_grep '^allowed-tools:' "$NPR_SKILL")
  for t in TaskCreate TaskUpdate TaskList TaskGet TaskStop ToolSearch; do
    echo "$line" | rg_or_grep -q "$t" || { echo "missing $t in new-pr allowed-tools"; return 1; }
  done
}

@test "new-pr carries the subagent reconciliation gate" {
  run rg_or_grep -q 'select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop' "$NPR_SKILL"
  assert_success
  run rg_or_grep -qi 'Subagent reconciliation gate' "$NPR_SKILL"
  assert_success
}
