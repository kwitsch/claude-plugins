#!/usr/bin/env bats

# fresh-branch skill + fresh-branch.sh — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "fresh-branch SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}
@test "fresh-branch frontmatter declares name and required allowed-tools" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/fresh-branch/SKILL.md'"
  assert_success
  assert_output --partial "name: fresh-branch"
  assert_output --partial "AskUserQuestion"
  assert_output --partial "Bash(git:*)"
}
@test "fresh-branch SKILL.md points at its reference doc before invoking" {
  run rg_or_grep -F 'fresh-branch.reference.md' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/fresh-branch.sh' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}
@test "fresh-branch worktree detection compares git-dir by inode, not string equality" {
  run rg_or_grep -F -- '-ef "$(git rev-parse --git-common-dir)"' "$PLUGIN/skills/fresh-branch/fresh-branch.sh"
  assert_success
}
@test "fresh-branch SKILL.md no longer embeds the script" {
  run rg_or_grep -F 'refresh_onto()' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_failure
}
@test "plugin README lists fresh-branch in a Skills section" {
  run rg_or_grep -F '| `fresh-branch`' "$PLUGIN/README.md"
  assert_success
}

# setup_git_fixture <dir> — bare "origin" repo + a work clone with an
# initial commit on the default branch, HEAD detected via origin/HEAD.
setup_git_fixture() {
  local dir="$1"
  git init --bare -q "$dir/origin.git"
  git clone -q "$dir/origin.git" "$dir/work"
  (
    cd "$dir/work" || exit 1
    git config user.email test@example.com
    git config user.name Test
    git commit -q --allow-empty -m init
    git push -q -u origin HEAD:main
    git remote set-head origin main
  )
}

# See Task 2's note on why this path is built inside the wrapper, not
# hoisted to a bare top-level variable ($PLUGIN isn't set until setup() runs).
run_freshbranch() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" bash "$PLUGIN/skills/fresh-branch/fresh-branch.sh" "$@"
}
@test "fresh-branch.sh: zero args refreshes the current branch onto default" {
  setup_git_fixture "$BATS_TEST_TMPDIR"
  cd "$BATS_TEST_TMPDIR/work" || return 1
  run_freshbranch
  assert_success
  assert_output --partial "mode: refresh"
}
@test "fresh-branch.sh: non-worktree, one arg creates a new branch off default" {
  setup_git_fixture "$BATS_TEST_TMPDIR"
  cd "$BATS_TEST_TMPDIR/work" || return 1
  run_freshbranch feature/x
  assert_success
  assert_output --partial "mode: create"
  assert_output --partial "branch: feature/x"
}
@test "fresh-branch.sh: refuses a branch name that already exists locally" {
  setup_git_fixture "$BATS_TEST_TMPDIR"
  cd "$BATS_TEST_TMPDIR/work" || return 1
  git branch feature/dup
  run_freshbranch feature/dup
  assert_failure 6
}
@test "fresh-branch.sh: no_remote when origin/HEAD is undetectable" {
  git init -q "$BATS_TEST_TMPDIR/lone"
  cd "$BATS_TEST_TMPDIR/lone" || return 1
  git config user.email test@example.com
  git config user.name Test
  git commit -q --allow-empty -m init
  run_freshbranch
  assert_failure 4
}
@test "fresh-branch.sh: stashes and pops uncommitted changes around a refresh" {
  setup_git_fixture "$BATS_TEST_TMPDIR"
  cd "$BATS_TEST_TMPDIR/work" || return 1
  echo dirty > file.txt
  run_freshbranch
  assert_success
  run cat file.txt
  assert_output "dirty"
}
@test "fresh-branch.sh: worktree context, one arg rebases onto the explicit base" {
  setup_git_fixture "$BATS_TEST_TMPDIR"
  cd "$BATS_TEST_TMPDIR/work" || return 1
  git branch other-base
  git push -q -u origin other-base
  git worktree add -q "$BATS_TEST_TMPDIR/wt" -b wt-branch
  cd "$BATS_TEST_TMPDIR/wt" || return 1
  run_freshbranch other-base
  assert_success
  assert_output --partial "mode: refresh"
  assert_output --partial "base: other-base"
}
@test "fresh-branch.sh: worktree context rejects more than one argument" {
  setup_git_fixture "$BATS_TEST_TMPDIR"
  cd "$BATS_TEST_TMPDIR/work" || return 1
  git worktree add -q "$BATS_TEST_TMPDIR/wt" -b wt-branch2
  cd "$BATS_TEST_TMPDIR/wt" || return 1
  run_freshbranch main extra
  assert_failure 2
  assert_output --partial "worktree: at most 1 arg"
}
