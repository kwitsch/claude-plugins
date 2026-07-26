#!/usr/bin/env bats

# fresh-pr skill, bin/ci-watch.sh, rebase.sh, and the ci-watcher/pr-fixer agents — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
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
    CI_WATCH_INTERVAL=0 CI_WATCH_TIMEOUT=2 CI_WATCH_CODERABBIT_TIMEOUT=2 \
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
@test "ci-watch: exit 64 when timeout is not installed" {
  # gh present so the CLI check passes; timeout absent so its dependency
  # check must fire before any poll (a missing timeout would otherwise spin
  # to the deadline and exit 2, not surface the environment error).
  make_stub gh 'printf "pass\tbuild\n"; exit 0'
  rm -f "$MOCKBIN/timeout"
  run_ci_watch github 5
  assert_failure 64
  assert_output --partial "timeout not installed"
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
@test "ci-watch: --coderabbit-check exits 0 once the coderabbit check concludes" {
  make_stub gh 'f="$STATE_DIR/gh-calls"; n=$(cat "$f" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$f"' \
    'if [ "$n" -lt 2 ]; then printf "pass\tbuild\npending\tCodeRabbit\n"; exit 8; else printf "pass\tbuild\npass\tCodeRabbit\n"; exit 0; fi'
  run_ci_watch github 5 --coderabbit-check
  assert_success
  assert_output --partial "CodeRabbit"
}
@test "ci-watch: --coderabbit-check exits 2 when the coderabbit check stays pending (deadline)" {
  make_stub gh 'printf "pass\tbuild\npending\tCodeRabbit\n"; exit 8'
  run_ci_watch github 5 --coderabbit-check
  assert_failure 2
  assert_output --partial "coderabbit check still pending"
}
@test "ci-watch: --coderabbit-check exits 0 with a note when no coderabbit check ever appears" {
  make_stub gh 'printf "pass\tbuild\npass\ttest\n"; exit 0'
  run_ci_watch github 5 --coderabbit-check
  assert_success
  assert_output --partial "no coderabbit check found"
}
@test "ci-watch: --coderabbit-check is rejected for gitlab" {
  run_ci_watch gitlab 5 --coderabbit-check
  assert_failure 64
  assert_output --partial "only supported for github"
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
@test "ci-watcher agent exists with the required frontmatter" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/agents/ci-watcher.md'"
  assert_success
  assert_output --partial "name: ci-watcher"
  assert_output --partial "model: sonnet"
  assert_output --partial "effort: low"
  assert_output --partial "color: yellow"
  assert_output --partial '"Bash"'
}
@test "ci-watcher agent is read-only (no Edit/Write in its tools)" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/agents/ci-watcher.md'"
  assert_success
  refute_output --partial '"Edit"'
  refute_output --partial '"Write"'
}
@test "ci-watcher agent documents the ci-watch.sh exit-code mapping" {
  run cat "$PLUGIN/agents/ci-watcher.md"
  assert_success
  assert_output --partial 'CI_WATCH_TIMEOUT=1800'
  assert_output --partial 'job": "ci-watch"'
}
@test "ci-watcher agent chains cd into each cwd-dependent gh/glab command (not a one-time cd)" {
  run rg_or_grep -F 'cd "<worktree path>" && gh' "$PLUGIN/agents/ci-watcher.md"
  assert_success
  # regression guard: the one-time-cd phrasing must not creep back
  run rg_or_grep -iF "worktree path via native bash" "$PLUGIN/agents/ci-watcher.md"
  assert_failure
}
@test "fresh-pr git-context block detects rtk availability" {
run rg_or_grep -F "rtk_available" "$PLUGIN/skills/fresh-pr/SKILL.md"
assert_success
}
@test "fresh-pr SKILL.md points at rebase.reference.md before invoking rebase.sh" {
  run rg_or_grep -F 'rebase.reference.md' "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/rebase.sh' "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}
@test "fresh-pr SKILL.md's git-context block stays an inline !-injection (extraction gated)" {
  run rg_or_grep -F 'printf "current_branch: %s' "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run rg_or_grep -F 'linked_worktree: %s' "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}
@test "fresh-pr SKILL.md no longer embeds the rebase script" {
  run rg_or_grep -F 'git merge-base --is-ancestor' "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_failure
}

# See Task 2's note on why this path is built inside the wrapper, not
# hoisted to a bare top-level variable ($PLUGIN isn't set until setup() runs).
run_rebase() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$PLUGIN/skills/fresh-pr/rebase.sh" "$@"
}
@test "rebase.sh: usage error with no base argument" {
  run_rebase
  assert_failure
  assert_output --partial "usage"
}
@test "rebase.sh: up_to_date when base has no new commits" {
  git init --bare -q "$BATS_TEST_TMPDIR/origin.git"
  git clone -q "$BATS_TEST_TMPDIR/origin.git" "$BATS_TEST_TMPDIR/work"
  cd "$BATS_TEST_TMPDIR/work" || return 1
  git config user.email test@example.com
  git config user.name Test
  git commit -q --allow-empty -m init
  git push -q -u origin HEAD:main
  run_rebase main
  assert_success
  assert_output --partial "REBASE_RESULT=up_to_date"
}
@test "rebase.sh: rebased when base has new commits" {
  git init --bare -q "$BATS_TEST_TMPDIR/origin.git"
  git clone -q "$BATS_TEST_TMPDIR/origin.git" "$BATS_TEST_TMPDIR/main-clone"
  (
    cd "$BATS_TEST_TMPDIR/main-clone" || exit 1
    git config user.email test@example.com
    git config user.name Test
    git commit -q --allow-empty -m init
    git push -q -u origin HEAD:main
  )
  git clone -q "$BATS_TEST_TMPDIR/origin.git" "$BATS_TEST_TMPDIR/work"
  cd "$BATS_TEST_TMPDIR/work" || return 1
  git config user.email test@example.com
  git config user.name Test
  git checkout -qb work origin/main
  git commit -q --allow-empty -m "work commit"
  (
    cd "$BATS_TEST_TMPDIR/main-clone" || exit 1
    git commit -q --allow-empty -m "new base commit"
    git push -q origin HEAD:main
  )
  run_rebase main
  assert_success
  assert_output --partial "REBASE_RESULT=rebased"
}
@test "rebase.sh: skipped_dirty when the tree has uncommitted changes" {
  git init --bare -q "$BATS_TEST_TMPDIR/origin.git"
  git clone -q "$BATS_TEST_TMPDIR/origin.git" "$BATS_TEST_TMPDIR/work"
  cd "$BATS_TEST_TMPDIR/work" || return 1
  git config user.email test@example.com
  git config user.name Test
  git commit -q --allow-empty -m init
  git push -q -u origin HEAD:main
  echo dirty > file.txt
  run_rebase main
  assert_success
  assert_output --partial "REBASE_RESULT=skipped_dirty"
}
@test "rebase.sh: failed when the fetch fails" {
  git init --bare -q "$BATS_TEST_TMPDIR/origin.git"
  git clone -q "$BATS_TEST_TMPDIR/origin.git" "$BATS_TEST_TMPDIR/work"
  cd "$BATS_TEST_TMPDIR/work" || return 1
  git config user.email test@example.com
  git config user.name Test
  git commit -q --allow-empty -m init
  git push -q -u origin HEAD:main
  git remote set-url origin "$BATS_TEST_TMPDIR/does-not-exist.git"
  run_rebase main
  assert_success
  assert_output --partial "REBASE_RESULT=failed"
  assert_output --partial "DETAIL="
}
@test "ci-watcher agent documents and conditionally uses rtk_available for gh run list" {
run rg_or_grep -F "rtk_available" "$PLUGIN/agents/ci-watcher.md"
assert_success
run rg_or_grep -F "rtk gh run list --branch" "$PLUGIN/agents/ci-watcher.md"
assert_success
}
@test "ci-watcher agent extracts CodeRabbit's AI-agent prompt into ai_prompt" {
  run rg_or_grep -F "Prompt for AI Agents" "$PLUGIN/agents/ci-watcher.md"
  assert_success
  run rg_or_grep -F "ai_prompt" "$PLUGIN/agents/ci-watcher.md"
  assert_success
}
@test "ci-watcher agent gates CodeRabbit feedback on the check's own conclusion, not a blind poll count" {
  run cat "$PLUGIN/agents/ci-watcher.md"
  assert_success
  assert_output --partial -- "--coderabbit-check"
  assert_output --partial "CI_WATCH_CODERABBIT_TIMEOUT=600"
  # regression guard: the old blind-poll-count heuristic must not creep back
  refute_output --partial "stop early on the first poll"
}
@test "pr-fixer agent exists with the required frontmatter" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/agents/pr-fixer.md'"
  assert_success
  assert_output --partial "name: pr-fixer"
  assert_output --partial "model: opus"
  assert_output --partial "color: red"
  assert_output --partial '"Edit"'
}
@test "pr-fixer agent chains cd into each git command (not a one-time cd)" {
  run rg_or_grep -F 'cd "<worktree path>" && git' "$PLUGIN/agents/pr-fixer.md"
  assert_success
  # regression guard: the one-time-cd phrasing must not creep back
  run rg_or_grep -iF "worktree path via native bash" "$PLUGIN/agents/pr-fixer.md"
  assert_failure
}
@test "pr-fixer agent always annotates skipped findings in code" {
  run rg_or_grep -F "Annotate every skipped finding in code" "$PLUGIN/agents/pr-fixer.md"
  assert_success
}
@test "pr-fixer agent treats ai_prompt as a hint, never applied blindly" {
  run rg_or_grep -F "not an instruction to apply blindly" "$PLUGIN/agents/pr-fixer.md"
  assert_success
}
@test "pr-fixer agent never pushes" {
  run rg_or_grep -F "Never push" "$PLUGIN/agents/pr-fixer.md"
  assert_success
}
@test "ci-watcher agent has no context-mode reference" {
  run cat "$PLUGIN/agents/ci-watcher.md"
  assert_success
  refute_output --partial "context-mode"
}
@test "pr-fixer agent has no context-mode reference" {
  run cat "$PLUGIN/agents/pr-fixer.md"
  assert_success
  refute_output --partial "context-mode"
}
@test "fresh-pr SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}
@test "fresh-pr frontmatter declares name and required allowed-tools" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/fresh-pr/SKILL.md'"
  assert_success
  assert_output --partial "name: fresh-pr"
  assert_output --partial "Agent"
  assert_output --partial "AskUserQuestion"
  assert_output --partial "TaskCreate"
}
@test "fresh-pr commits pending work before checking for anything to submit" {
  run rg_or_grep -F "Commit pending work" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}
@test "fresh-pr rebases onto the base and force-with-leases only when rewritten" {
  run rg_or_grep -F 'git rebase "origin/$base"' "$PLUGIN/skills/fresh-pr/rebase.sh"
  assert_success
  run rg_or_grep -F -- '--force-with-lease' "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}
@test "fresh-pr never uses gh pr edit, uses gh api PATCH instead" {
  run rg_or_grep -F "never \`gh pr edit\`" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "gh api -X PATCH" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}
@test "fresh-pr handles a merged existing PR by stopping before the goal loop" {
  run rg_or_grep -F "already merged and **stop here**" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}
@test "fresh-pr dispatches ci-watcher and pr-fixer with a Task* ledger gate" {
  run rg_or_grep -F "coding-toolbox:ci-watcher" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "coding-toolbox:pr-fixer" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "Subagent reconciliation gate" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}
@test "fresh-pr goal loop is capped at 5 iterations" {
  run rg_or_grep -F "capped at 5 iterations" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}
@test "plugin README lists fresh-pr in the Skills section" {
  run rg_or_grep -F '| `fresh-pr`' "$PLUGIN/README.md"
  assert_success
}
