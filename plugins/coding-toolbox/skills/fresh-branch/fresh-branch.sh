#!/usr/bin/env bash
# fresh-branch: with no arguments, always fetch + rebase the *current*
# branch onto the repo default branch in place (no new branch created),
# whether or not you're in a worktree. With arguments, outside a worktree
# it cuts a new branch off an (optionally custom) base; inside a worktree a
# single argument is an explicit base to refresh onto instead. Uncommitted
# changes are auto-stashed before and popped after — in the new branch when
# one is created, in place otherwise.
#
# Usage (no args):       fresh-branch.sh
# Usage (worktree):      fresh-branch.sh <base>
# Usage (non-worktree):  fresh-branch.sh <branch-name> [base]
#
# Exit: 0 ok · 2 usage · 3 stash_failed · 4 no_remote · 5 git_op_failed ·
#       6 name_exists (non-worktree) · 7 rebase_conflict (refresh path) ·
#       8 pop_conflict (stash left in place, everything else succeeded)
set -uo pipefail

is_worktree=false
# Compare by device+inode (-ef), not string equality: from a subdirectory
# --git-dir is absolute while --git-common-dir is relative (e.g. ../../.git),
# so the same main-worktree dir would compare unequal as strings.
[ "$(git rev-parse --git-dir)" -ef "$(git rev-parse --git-common-dir)" ] || is_worktree=true

detect_default() {
  git remote set-head origin --auto >/dev/null 2>&1 || true
  local d
  d="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')"
  [ -n "$d" ] || d="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"
  printf '%s' "$d"
}

stashed=false
stash_if_dirty() {
  [ -n "$(git status --porcelain)" ] || return 0
  if ! err="$(git stash push -u -m fresh-branch-autostash 2>&1 1>/dev/null)"; then
    printf '%s\n' "$err" >&2
    exit 3
  fi
  stashed=true
}

# Pops the autostash if one was made. Returns 1 (does not exit) on pop
# failure so callers decide how to report it without losing the stash.
pop_stash() {
  [ "$stashed" = true ] || return 0
  if ! err="$(git stash pop 2>&1 1>/dev/null)"; then
    printf '%s\n' "$err" >&2
    return 1
  fi
  return 0
}

# Fetch + rebase the current branch onto origin/$1 in place. Never creates or
# switches branches. Used both for the universal no-args refresh and for the
# worktree explicit-base form.
refresh_onto() {
  base="$1"
  stash_if_dirty

  if ! err="$(git fetch origin "$base" 2>&1 1>/dev/null)"; then
    printf '%s\n' "$err" >&2
    pop_stash || echo "stash pop also failed; stash preserved" >&2
    exit 5
  fi

  if git rebase "origin/$base" >/dev/null 2>&1; then
    pop_ok=true
    pop_stash || pop_ok=false
    printf 'mode: refresh\nbranch: %s\nbase: %s\ncommit: %s\n' "$(git branch --show-current)" "$base" "$(git log -1 --oneline)"
    [ "$pop_ok" = true ] || exit 8
    exit 0
  else
    git rebase --abort >/dev/null 2>&1 || true
    pop_stash || echo "stash pop also failed; stash preserved" >&2
    echo "rebase conflict against origin/$base" >&2
    exit 7
  fi
}

if [ "$#" -eq 0 ]; then
  base="$(detect_default)"
  [ -n "$base" ] || { echo "origin/HEAD undetectable (no remote / offline)" >&2; exit 4; }
  refresh_onto "$base"
elif [ "$is_worktree" = true ]; then
  [ "$#" -eq 1 ] || { echo "usage: fresh-branch.sh [base]  (worktree: at most 1 arg)" >&2; exit 2; }
  refresh_onto "$1"
else
  [ "$#" -le 2 ] || { echo "usage: fresh-branch.sh <branch-name> [base]  (non-worktree: at most 2 args)" >&2; exit 2; }
  branch="$1"
  base="${2:-}"
  [ -n "$base" ] || base="$(detect_default)"
  [ -n "$base" ] || { echo "origin/HEAD undetectable (no remote / offline)" >&2; exit 4; }

  git show-ref --verify --quiet "refs/heads/$branch"          && { echo "$branch exists locally"  >&2; exit 6; }
  git show-ref --verify --quiet "refs/remotes/origin/$branch" && { echo "$branch exists on remote" >&2; exit 6; }

  stash_if_dirty

  if ! err="$(git checkout "$base" 2>&1 1>/dev/null)"; then
    printf '%s\n' "$err" >&2
    pop_stash || echo "stash pop also failed; stash preserved" >&2
    exit 5
  fi
  if ! err="$(git pull --ff-only origin "$base" 2>&1 1>/dev/null)"; then
    printf '%s\n' "$err" >&2
    pop_stash || echo "stash pop also failed; stash preserved" >&2
    exit 5
  fi
  if ! err="$(git checkout -b "$branch" 2>&1 1>/dev/null)"; then
    printf '%s\n' "$err" >&2
    pop_stash || echo "stash pop also failed; stash preserved" >&2
    exit 5
  fi

  pop_ok=true
  pop_stash || pop_ok=false
  printf 'mode: create\nbranch: %s\nbase: %s\ncommit: %s\n' "$branch" "$base" "$(git log -1 --oneline)"
  [ "$pop_ok" = true ] || exit 8
fi
