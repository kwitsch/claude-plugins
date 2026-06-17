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
   # Usage: <branch-name>
   # Exit: 0 ok · 3 dirty_tree · 4 no_remote · 5 git op failed (checkout-default / pull / checkout-b) · 6 name_exists
   set -uo pipefail
   branch="${1:?usage: <branch-name>}"

   # 1) clean-tree guard — never switch branches over uncommitted changes
   status="$(git status --porcelain)"
   if [ -n "$status" ]; then printf '%s\n' "$status" | head -5 >&2; exit 3; fi

   # 2) detect the default branch — refresh origin/HEAD first (it goes stale)
   # same origin/HEAD recipe as new-pr/SKILL.md precondition 2 — keep in sync
   git remote set-head origin --auto >/dev/null 2>&1 || true
   default="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')"
   [ -n "$default" ] || default="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"
   [ -n "$default" ] || { echo "origin/HEAD undetectable (no remote / offline)" >&2; exit 4; }

   # 3) update the default branch — never branch off a stale base
   if ! err="$(git checkout "$default" 2>&1 1>/dev/null)"; then printf '%s\n' "$err" >&2; exit 5; fi
   if ! err="$(git pull --ff-only 2>&1 1>/dev/null)"; then printf '%s\n' "$err" >&2; exit 5; fi

   # 4) the name must be free, locally and on the remote (fresh after the pull)
   git show-ref --verify --quiet "refs/heads/$branch"          && { echo "$branch exists locally"   >&2; exit 6; }
   git show-ref --verify --quiet "refs/remotes/origin/$branch" && { echo "$branch exists on remote" >&2; exit 6; }

   # 5) create and switch
   if ! err="$(git checkout -b "$branch" 2>&1 1>/dev/null)"; then printf '%s\n' "$err" >&2; exit 5; fi
   printf 'branch: %s\nbase: %s\ncommit: %s\n' "$branch" "$default" "$(git log -1 --oneline)"
   ```

3. **Map the exit code.**
   - `0` — success; keep the `branch:` / `base:` / `commit:` lines for the report.
   - `3` `dirty_tree` — the tree had uncommitted changes (still on the original
     branch). Ask the user: commit, stash, or abort? Execute the choice, then
     re-run step 2.
   - `4` `no_remote` — report the detail and stop; never branch off an unknown base.
   - `5` — a git operation failed (pull, or the checkout of the default/new branch). Report the git error from stderr and stop. If the pull failed the tree is now on the default branch (the starting branch changed — say so); if switching to the default branch itself failed the tree is unchanged. Report what stderr indicates.
   - `6` `name_exists` — the tree is now on the default branch; mention that. Ask
     the user: switch to the existing branch (`git checkout <branch>` — creates a
     tracking branch when it is remote-only) or pick a different name, then
     re-run step 2.
   - any other non-zero — report stderr + the exit code, and stop.

4. **Initialize branch tooling.** On success, invoke the
   `branch-management:init-branch` skill (Skill tool) with no arguments. It
   resolves the repo root and all graphify/context-mode toggles itself, runs
   background Bash for the graphify refresh + a direct ctx_index MCP call, and
   returns structured graphify + ctx-index outcome lines. (Skipped silently if
   both its toggles are off — it reports that.)

5. **Report:** the new branch name and the commit it was cut from (from the
   script's success output), then the init-branch skill's graphify + ctx-index
   outcome lines verbatim.
