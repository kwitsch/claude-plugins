---
name: finish
description: Wraps up a finished work branch: final verification, then the user chooses how to integrate it. Use when implementation and review are done.
---

# finish

1. **Verify:** `jev-solver:verify` on the branch; do not go on while anything fails.
2. **Show the state:** branch, base, commits, `git status` clean or not.
3. **Ask how to integrate** through `AskUserQuestion` (this is the user's decision, never `jev-solver:decide`): open a PR (draft by default), merge locally into the base, keep the branch as is, or discard the work.
4. **Execute the choice** following the repo's conventions (commit message style, rebase rules, required checks). Pushing, opening a PR and merging are outward-facing: only after the choice above.
5. **Discard** only after the user confirms again with the branch and commit count named; delete nothing else.
6. **Clean up:** a worktree this session created is removed after merge or discard, kept for PR and keep. The spec and plan stay in the scratchpad.
7. Save lasting decisions and conventions of the task with `graphmind memory add` when graphmind is available.
