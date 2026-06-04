---
name: new-branch
description: Use when starting new feature, fix, or chore work that needs its own branch - switches to the default branch, pulls the latest state, creates and checks out a new work branch, and refreshes the context-mode index when that plugin is installed.
model: haiku
---

# Start a new work branch

Cut a fresh branch from the up-to-date default branch so new work never starts
on a stale or wrong base.

## Steps

1. **Guard — clean working tree.** Run `git status --porcelain`. If it prints
   anything, stop and ask the user whether to commit, stash, or abort. Never
   switch branches over uncommitted changes.

2. **Detect the default branch.** Refresh `origin/HEAD` first — it is set at
   clone time and goes stale when the remote's default branch changes:

   ```bash
   git remote set-head origin --auto >/dev/null 2>&1 || true
   default=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
   [ -n "$default" ] || default=$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')
   ```

   If both come back empty (no remote, offline), ask the user for the base
   branch instead of guessing.

3. **Update it:** `git checkout "$default" && git pull --ff-only`. If the pull
   fails (diverged local default branch, network error), report the error and
   stop — never branch off a stale base.

4. **Pick the branch name.** If the user passed an argument, use it: a full
   name like `fix/parser-crash` is taken verbatim; a bare description is
   slugged into `<type>/<kebab-case-slug>`. Otherwise derive the name from the
   task at hand in the conversation, choosing `<type>` from `feat`, `fix`,
   `chore`, or `docs`. If there is no task context to derive from, ask.

5. **Create and switch.** If the name already exists
   (`git show-ref --verify --quiet "refs/heads/<branch>"` succeeds), stop and
   ask the user whether to switch to the existing branch or pick a different
   name. Otherwise: `git checkout -b <branch>`.

6. **context-mode indexing (only if installed).** If the context-mode plugin
   is available in this session (its `context-mode:ctx-index` skill appears in
   the skill list), invoke that skill for the repository root so the knowledge
   base reflects the new branch state. If the plugin is not installed, skip
   this step silently — its absence is not an error.

7. **Report:** the new branch name and the commit it was cut from
   (`git log -1 --oneline`).
