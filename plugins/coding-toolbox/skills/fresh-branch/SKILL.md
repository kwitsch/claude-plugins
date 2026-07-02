---
name: fresh-branch
description: Use to start a fresh work branch off an optional custom base, or — with no arguments (or inside a linked git worktree) — fetch and rebase the current branch onto its base in place instead of switching branches. Auto-stashes and restores uncommitted changes around the operation.
argument-hint: "[branch-name|base] [base]"
allowed-tools: ["AskUserQuestion", "Bash(git:*)", "Bash(bash:*)"]
---

# Start or refresh a branch

With no arguments this skill always fetches and rebases the *current* branch onto
the repo's default branch in place — no new branch is created, whether or not
you're in a worktree. With arguments, outside a git worktree it instead cuts a
brand-new branch off an up-to-date base (the default branch, or an explicit second
argument). Inside a **linked worktree**, a single argument is treated as an
explicit upstream/base to refresh onto instead of the default. Uncommitted changes
are stashed before either operation and popped afterward: in the newly created
branch when one is created, in place otherwise.

Parameter meaning depends on context (the script below detects it and validates
the argument count itself):

| Context | Args | Meaning |
|---|---|---|
| any | 0 | fetch+rebase current branch onto the repo default branch |
| worktree | 1 | fetch+rebase onto `$1` (explicit upstream/base) |
| non-worktree | 1 | create branch `$1` off the repo default branch |
| non-worktree | 2 | create branch `$1` off base `$2` |

Any explicit base — the worktree single argument (`$1`) or the non-worktree
second argument (`$2`) — is an **origin-tracked branch name**: it is resolved as
`origin/<name>` (fetch/pull/rebase). `fresh-branch` works with remote `origin`
only; "upstream" here means a base branch on `origin`, not a different git remote.

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification.

## Steps

1. **Run the script below via the Bash tool**, passing through the caller's
   arguments unchanged (0, 1, or 2 positional args — whatever was given). The
   script detects worktree state and validates the argument count for that
   context itself; it does not need to be told which context it's in.

   ```bash
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
   ```

2. **Map the exit code.**
   - `0` — success; keep the `mode:` / `branch:` / `base:` / `commit:` lines for
     the report.
   - `2` `usage` — the caller passed the wrong number of arguments for the
     detected context (e.g. 2 args inside a worktree, or 3+ args outside one).
     Report the stderr message and stop.
   - `3` `stash_failed` — the tree was dirty but `git stash push -u` itself
     failed (rare). Report stderr and stop; nothing was touched.
   - `4` `no_remote` — `origin/HEAD` undetectable (no remote / offline). Report
     and stop; never guess a base.
   - `5` `git_op_failed` — fetch/checkout/pull/checkout-b failed. Report the git
     error from stderr and stop. In non-worktree mode: if the checkout of `$base`
     succeeds but a later step fails, the tree is now on `$base` (not the
     original branch). If the failure happened after a stash, the stash-pop
     outcome is already on stderr — never re-run blindly, inspect state first.
   - `6` `name_exists` — non-worktree only; this check runs *before* any stash
     or branch switch, so nothing was touched. Ask the user via
     `AskUserQuestion` — options **Switch to existing branch** (`git checkout
     <branch>`) / **Pick a different name** — then re-run step 1.
   - `7` `rebase_conflict` — the refresh path only (no args in any context, or
     worktree with an explicit base); the rebase was aborted so the branch is
     back to its pre-rebase state (stash popped or preserved — check stderr).
     Report the conflict; resolve manually.
   - `8` `pop_conflict` — the primary operation (branch created, or rebase
     done) succeeded — read the `mode:`/`branch:`/`base:`/`commit:` lines — but
     the final `git stash pop` failed. Report explicitly that the stash is
     preserved (`git stash list`) for manual recovery; never say the operation
     fully succeeded without this caveat.

3. **Report:** the mode (`create` vs `refresh`), branch name, base, and
   commit from the script's printed lines.
