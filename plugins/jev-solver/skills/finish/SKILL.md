---
name: finish
description: Wraps up a finished work branch: final verification, then commits, pushes and opens a draft PR. Use when implementation and review are done.
---

# finish

1. **Verify:** `jev-solver:verify` on the branch; do not go on while anything fails.
2. **Show the state:** branch, base, commits, `git status` clean or not.
3. **Commit and push.** Commit every change this task made (not changes that were already there when it started) following the repo's conventions and push the work branch (set the upstream). Nothing may stay uncommitted or unpushed.
4. **Draft PR.** Open a draft PR for the branch against its base, or confirm one already exists (`gh pr view`); a PR that exists is only updated by the push. Report its URL. Merging, keeping the branch without a PR and discarding are only done when the user asks for them.
5. **Discard** only on the user's request and after they confirm again with the branch and commit count named; delete nothing else.
6. **Clean up:** a worktree this session created is kept while the PR is open; removed after merge or discard. The spec and plan stay in the scratchpad.
7. Save lasting decisions and conventions of the task with `graphmind memory add` when graphmind is available.
