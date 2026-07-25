# rebase — script reference

**Invoke:** `bash ${CLAUDE_SKILL_DIR}/rebase.sh <base>`

## Parameters

| #   | Name | Format                                                          | Required | Notes                                                    |
| --- | ---- | --------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| 1   | base | an already-locally-resolvable branch name (no `origin/` prefix) | yes      | Enforced by the script itself via `${1:?usage: <base>}`. |

## Exit codes

`1` — usage error: `base` was empty/unset (bash's `${1:?usage: <base>}`
prints a `usage: <base>` message to stderr). Otherwise always exits `0` —
the outcome is carried on the printed `REBASE_RESULT=` (and sometimes
`DETAIL=`) stdout line(s), not the process exit code.

| `REBASE_RESULT=` | Meaning                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `up_to_date`     | base has no new commits; nothing to do                                                                                               |
| `rebased`        | history was rewritten; the caller's next push MUST use `--force-with-lease`                                                          |
| `skipped_dirty`  | uncommitted changes remain; commit or stash them and re-run                                                                          |
| `conflict`       | rebase hit conflicts and was aborted (branch unchanged) — stop, do not push or touch the PR/MR; hand to the user to resolve manually |
| `failed`         | fetch/setup failed (e.g. offline) — `DETAIL=` carries a truncated error; branch is still pushable, PR may just sit behind base       |
