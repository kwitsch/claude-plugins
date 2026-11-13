# pr

The pull request of the work branch, kept current from the first commit to the end. No question about opening or updating it.

## After the first commit

Push the work branch (set the upstream) and open a draft PR against its base (`gh pr create --draft`), title and description from the task and what is committed so far. If a PR for the branch exists (`gh pr view`), only update it. Report the URL once.

## After every push

Every push is followed by an update of the PR description (`gh pr edit --body`) so it matches the branch as pushed: what and why, the main changes, how it was verified, open points. Rewrite it from the current diff and commits, never append stale text. Push after each commit or phase end, not only at the end.

## Merge-ready (last step of the track, in [finish](finish.reference.md))

1. Fetch the base and bring the branch up to date with it (rebase, or merge if the repo's CLAUDE.md says so; without a convention jev-api `choice` via [decide](decide.reference.md)). Resolve every conflict by reading both sides (an unclear hunk: jev-api `choice` ours, theirs or both, then check it against the code), keeping the intent of both changes; never drop either side to make it go away. Then [verify](verify.reference.md) again.
2. Push (after a rebase `--force-with-lease`, on this work branch only), then update the description once more.
3. `gh pr view --json mergeable,mergeStateStatus` must show no conflicts (`MERGEABLE`, not `DIRTY`); `gh pr checks` must be green. Ask jev-api (`batch`, one `noul` per failing check) whether each is flaky or environmental; if not, fix it as a [debug](debug.reference.md) case, push, update the description, check again. Do not wait in a loop for checks that are still running longer than a few minutes: report them as pending.
4. Mark the PR ready for review (`gh pr ready`).
5. Report the URL and the state: pushed, description current, no conflicts, checks. Merging itself is only done when the user asks for it.
