---
name: new-branch
description: Use when starting new feature, fix, or chore work that needs its own branch - switches to the default branch, pulls the latest state and creates a new work branch via an inline git script, then invokes the init-branch skill to refresh the graphify output and context-mode index (graphify_branch_update / graphify_force_create / graphify_user_files and context_index options).
argument-hint: "[branch-name | task description]"
allowed-tools: ["Skill", "Bash(git:*)", "Bash(echo:*)", "Bash(bash:*)"]
---

# Start a new work branch

This skill cuts a fresh work branch from the up-to-date default branch. The git
mechanics run inline as a single **synchronous** Bash script (no subagent) — the
script returns before the skill advances, so there is no race against the shared
working tree and no completion-reconciliation ledger to maintain.

Inside a **linked worktree** (e.g. a bridge/remote session) the default branch is
checked out in the primary worktree, so switching to it is impossible. There the
script skips the create+switch and keeps the current branch as the work branch
(exit `7`); init-branch then refreshes that branch in place via fetch +
self-rebase. Keeping the current branch is also what lets a later `new-pr`
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
   # branch name, and init-branch refreshes the base via fetch + self-rebase.
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

4. **Initialize branch tooling.** On success, invoke the
   `branch-management:init-branch` skill (Skill tool). It resolves the repo root
   and all graphify/context-mode toggles itself, runs background Bash for the
   graphify refresh + a direct ctx_index MCP call, and returns structured
   graphify + ctx-index outcome lines. (Skipped silently if both its toggles are
   off — it reports that.)
   - Exit `0` (normal): invoke it with **no arguments**.
   - Exit `7` (worktree): invoke it with `--worktree-rebase <base>`, taking
     `<base>` from the script's `base:` line, so it refreshes the kept branch via
     a synchronous fetch + self-rebase onto `origin/<base>` before the graphify
     refresh.

5. **Report:** the branch name and the commit it points at (from the script's
   `branch:` / `commit:` lines) — on exit `7` note the linked worktree was kept
   on its current branch and the determined name (`<type>/<slug>`) will serve as
   PR title context, not as a branch name — then the init-branch skill's rebase
   (worktree only) + graphify + ctx-index outcome lines verbatim.
