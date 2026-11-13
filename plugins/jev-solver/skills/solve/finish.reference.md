# finish

1. **Verify:** [verify](verify.reference.md) on the branch; do not go on while anything fails.
2. **Show the state:** branch, base, commits, `git status` clean or not.
3. **Commit.** Commit every change this task made (not changes that were already there when it started) following the repo's conventions. Nothing may stay uncommitted.
4. **Pull request.** Follow [pr](pr.reference.md): push, update the PR description, bring the branch up to date with its base and resolve all conflicts, checks green, mark ready. The skill ends only when everything is pushed, the description is current, no merge conflicts remain and the PR is merge-ready. Merging, keeping the branch without a PR and discarding are only done when the user asks for them.
5. **Discard** only on the user's request and after they confirm again with the branch and commit count named; delete nothing else.
6. **Clean up:** a worktree this session created is kept while the PR is open; removed after merge or discard. The design, spec and plan stay in the scratchpad.
7. Save lasting decisions and conventions of the task with `graphmind memory add` when graphmind is available; one jev-api `batch` of `noul` questions ([decide](decide.reference.md)), one per candidate, says which are worth saving.
