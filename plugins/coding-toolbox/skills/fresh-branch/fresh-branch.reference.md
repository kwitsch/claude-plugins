# fresh-branch — script reference

**Invoke:** `bash ${CLAUDE_SKILL_DIR}/fresh-branch.sh [arg1] [arg2]`

## Parameters

| #   | Name | Format                                                    | Required | Notes                                                                                       |
| --- | ---- | --------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| 1   | arg1 | branch name (non-worktree) or base branch name (worktree) | no       | Meaning depends on worktree context — see `SKILL.md`'s "Context × arg-count meaning" table. |
| 2   | arg2 | base branch name (non-worktree only)                      | no       | Only valid when arg1 is a new branch name outside a worktree.                               |

## Exit codes

| Code | Meaning         | Notes                                                                                                                                                                                                                                                            |
| ---- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | ok              | success; prints `mode:`/`branch:`/`base:`/`commit:` lines                                                                                                                                                                                                        |
| 2    | usage           | wrong argument count for the detected context                                                                                                                                                                                                                    |
| 3    | stash_failed    | tree was dirty but `git stash push -u` itself failed                                                                                                                                                                                                             |
| 4    | no_remote       | `origin/HEAD` undetectable (no remote / offline)                                                                                                                                                                                                                 |
| 5    | git_op_failed   | fetch/checkout/pull/checkout-b failed. Non-worktree mode only: if the `git checkout $base` step already succeeded before a later step failed, the tree is now checked out on `$base`, not the branch you started on — never re-run blindly, inspect state first. |
| 6    | name_exists     | non-worktree only; branch name already exists locally or on remote — runs before any stash/switch, nothing touched                                                                                                                                               |
| 7    | rebase_conflict | refresh path only; rebase was aborted, branch back to pre-rebase state                                                                                                                                                                                           |
| 8    | pop_conflict    | primary operation succeeded but the final `git stash pop` failed — stash preserved for manual recovery                                                                                                                                                           |
