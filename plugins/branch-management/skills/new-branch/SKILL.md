---
name: new-branch
description: Use when starting new feature, fix, or chore work that needs its own branch - switches to the default branch, pulls the latest state and creates a new <type>/<slug> work branch via an inline synchronous git script. Inside a linked worktree it keeps the current branch and self-rebases it onto the updated default in place.
argument-hint: "[branch-name | task description]"
allowed-tools: ["AskUserQuestion", "Bash(git:*)", "Bash(echo:*)", "Bash(bash:*)"]
---

# Start a new work branch

This skill cuts a fresh work branch from the up-to-date default branch. The git
mechanics run inline as a single **synchronous** Bash script (no subagent) — the
script returns before the skill advances, so there is no race against the shared
working tree and no completion-reconciliation ledger to maintain.

Inside a **linked worktree** (e.g. a bridge/remote session) the default branch is
checked out in the primary worktree, so switching to it is impossible. There the
script skips the create+switch and keeps the current branch as the work branch
(exit `7`); the script below self-rebases that branch in place via fetch +
rebase. Keeping the current branch is also what lets a later `new-pr`
register as the remote session's PR — the remote tracks the session branch.

Limitation: this applies to **any** linked worktree, including a generic
user-created one. There too the passed/derived name is recorded as PR title
context, not applied as a branch name (even though `git checkout -b` would
technically work outside a bridge session). If you want a brand-new named branch
in a generic worktree, create and switch to it before invoking this skill.

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification. Open-ended,
> free-text prompts may be asked inline, but prefer `AskUserQuestion` whenever the
> choices can be enumerated.

## Steps

1. **Decide the branch name.** Exactly one source:
   - an explicit branch name passed as argument → use it verbatim;
   - a bare task description (argument or conversation context) → slug it into
     `<type>/<kebab-case-slug>`, `<type>` ∈ `feat`, `fix`, `chore`, `docs`;
   - no argument and nothing to derive from → ask the user first.

2. **Cut the branch (inline).** Run the script below via the Bash tool with the
   name from step 1 as its only argument. It guards a clean tree, refreshes
   `origin/HEAD`, updates the default branch, checks the name is free, and
   creates the branch — reporting through a structured exit code. Wait for it to
   return (synchronous; no background, no dispatch) before any further step.

   ```bash
   #!/usr/bin/env bash
   # Cut a fresh work branch from the up-to-date default branch.
   # Inside a linked worktree the default branch is (usually) checked out in the
   # primary worktree, so `git checkout <default>` fails — there we skip the
   # create+switch entirely and KEEP the current branch as the work branch
   # (exit 7); the determined name is then used only as PR title context, not as a
   # branch name; step 4 self-rebases the kept branch onto the updated default.
   # Usage: <branch-name>
   # Exit: 0 ok · 3 dirty_tree · 4 no_remote · 5 git op failed (checkout-default / pull / checkout-b) · 6 name_exists · 7 worktree (kept current branch)
   set -uo pipefail
   branch="${1:?usage: <branch-name>}"

   # 1) detect the default branch — refresh origin/HEAD first (it goes stale)
   # same origin/HEAD recipe as new-pr/SKILL.md precondition 2 — keep in sync
   git remote set-head origin --auto >/dev/null 2>&1 || true
   default="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')"
   [ -n "$default" ] || default="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"
   [ -n "$default" ] || { echo "origin/HEAD undetectable (no remote / offline)" >&2; exit 4; }

   # 2) linked-worktree guard — git-dir differs from the common git dir only in a
   # linked worktree. There we cannot switch to the default branch (checked out
   # elsewhere) and must not create+switch; keep the current branch instead.
   if [ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]; then
     printf 'branch: %s\nbase: %s\ncommit: %s\n' "$(git branch --show-current)" "$default" "$(git log -1 --oneline)"
     exit 7
   fi

   # 3) clean-tree guard — never switch branches over uncommitted changes
   status="$(git status --porcelain)"
   if [ -n "$status" ]; then printf '%s\n' "$status" | head -5 >&2; exit 3; fi

   # 4) update the default branch — never branch off a stale base
   if ! err="$(git checkout "$default" 2>&1 1>/dev/null)"; then printf '%s\n' "$err" >&2; exit 5; fi
   if ! err="$(git pull --ff-only 2>&1 1>/dev/null)"; then printf '%s\n' "$err" >&2; exit 5; fi

   # 5) the name must be free, locally and on the remote (fresh after the pull)
   git show-ref --verify --quiet "refs/heads/$branch"          && { echo "$branch exists locally"   >&2; exit 6; }
   git show-ref --verify --quiet "refs/remotes/origin/$branch" && { echo "$branch exists on remote" >&2; exit 6; }

   # 6) create and switch
   if ! err="$(git checkout -b "$branch" 2>&1 1>/dev/null)"; then printf '%s\n' "$err" >&2; exit 5; fi
   printf 'branch: %s\nbase: %s\ncommit: %s\n' "$branch" "$default" "$(git log -1 --oneline)"
   ```

3. **Map the exit code.**
   - `0` — success; keep the `branch:` / `base:` / `commit:` lines for the report.
   - `3` `dirty_tree` — the tree had uncommitted changes (still on the original
     branch). Ask the user via `AskUserQuestion` how to proceed — options
     **Commit** (commit the changes, then cut the branch) / **Stash** (stash, cut
     the branch, then unstash) / **Abort** (stop — leave the tree as-is). Execute
     the choice, then re-run step 2.
   - `4` `no_remote` — report the detail and stop; never branch off an unknown base.
   - `5` — a git operation failed (pull, or the checkout of the default/new branch). Report the git error from stderr and stop. If the pull failed the tree is now on the default branch (the starting branch changed — say so); if switching to the default branch itself failed the tree is unchanged. Report what stderr indicates.
   - `6` `name_exists` — the tree is now on the default branch; mention that. Ask
     the user via `AskUserQuestion` — options **Switch to existing branch**
     (`git checkout <branch>` — creates a tracking branch when it is remote-only) /
     **Pick a different name** — then re-run step 2.
   - `7` `worktree` — a linked worktree was detected; no branch was created or
     switched (the default branch is checked out elsewhere). The script kept the
     current branch — keep its `branch:` / `base:` lines. The determined name from
     step 1 is **not** applied as a branch name; it is only PR title context later.
     This is expected and a success: proceed to step 4. (In a bridge/remote
     session the current branch is the session branch the remote tracks for its
     session PR — keeping it is what lets a later `new-pr` register as that PR.)
   - any other non-zero — report stderr + the exit code, and stop.

4. **Worktree self-rebase (exit `7` only).** On a normal create (exit `0`) there
   is nothing further to do. On the linked-worktree path (exit `7`) the default
   branch could not be checked out, so refresh the kept branch in place: run the
   script below via the Bash tool, passing the `base:` value from step 2's output
   as its only argument. **Synchronous native Bash** (git writes — never the ctx
   sandbox). It always exits `0`; read the outcome from the `REBASE_RESULT=` line.

   ```bash
   #!/usr/bin/env bash
   # self-rebase the current worktree branch onto the refreshed default branch.
   # Synchronous native Bash (git writes). Always exits 0 — REBASE_RESULT carries
   # the outcome; a non-zero exit means a harness/dispatch error, not a git status.
   set -uo pipefail
   default="${1:-}"
   [ -n "$default" ] || { echo "REBASE_RESULT=failed"; echo "DETAIL=no default branch given"; exit 0; }
   root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "REBASE_RESULT=failed"; echo "DETAIL=not inside a git repository"; exit 0; }
   cd "$root" || { echo "REBASE_RESULT=failed"; echo "DETAIL=cannot cd to repo root"; exit 0; }
   # a rebase needs a clean tree — skip (never stash silently) if dirty
   if [ -n "$(git status --porcelain)" ]; then echo "REBASE_RESULT=skipped_dirty"; exit 0; fi
   if ! out="$(git fetch origin "$default" 2>&1)"; then
     echo "REBASE_RESULT=failed"; echo "DETAIL=fetch: $(printf '%s' "$out" | tail -2 | tr '\n' ' ' | cut -c1-200)"; exit 0
   fi
   if git rebase "origin/$default" >/dev/null 2>&1; then
     echo "REBASE_RESULT=rebased"
   else
     git rebase --abort >/dev/null 2>&1 || true   # never leave a half-rebased tree
     echo "REBASE_RESULT=conflict"
   fi
   exit 0
   ```

   Outcome (read the `REBASE_RESULT=` line):
   - `rebased` → `self-rebased onto origin/<default>`
   - `skipped_dirty` → `rebase skipped: uncommitted changes`
   - `conflict` → `rebase aborted: conflicts with origin/<default> — resolve manually`
   - `failed` → `rebase failed` + `DETAIL`

5. **Report:** the branch name and the commit it points at (from the script's
   `branch:` / `commit:` lines). On exit `7` note the linked worktree was kept
   on its current branch and the determined name (`<type>/<slug>`) will serve as
   PR title context, not as a branch name; append the rebase outcome from step 4.
