---
name: worktree
description: Puts work into its own git worktree on a feat/ or fix/ branch, never on main or in the user's checkout. Used by jev-solver:solve right after triage; use it directly when work starts outside solve.
---

# worktree

1. **Where am I?** `git branch --show-current` and `git rev-parse --show-toplevel`. Already in a linked worktree (git dir differs from the common dir): do not nest, only switch the branch (step 4). On a work branch with its own commits: stay, and say so.
2. **Uncommitted changes** belong to the user: do not stash, reset or discard them. If they would be in the way, ask through `AskUserQuestion`.
3. **Branch name:** `feat/<slug>` for features, refactors and small changes, `fix/<slug>` for bugs; slug short and kebab-case, at most 40 characters, following the repo's conventions if it has any.
4. **Create and switch:** call `EnterWorktree` with the slug (load it via ToolSearch if deferred), then in the worktree `git switch -c <branch>` so the work is on the named branch and not on the harness's own `worktree-*` branch. Without `EnterWorktree`: `git worktree add <path> -b <branch>` from the default branch, using the repo's worktree directory convention and a git-ignored location.
5. **Set up and baseline:** install dependencies the repo's way, run the tests once. A failing baseline is reported to the user before any change, so new failures can be told apart.
6. Report the branch and the worktree path.
