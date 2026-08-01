# apply-pr-update — script reference

**Invoke:** `bash ${CLAUDE_SKILL_DIR}/scripts/apply-pr-update.sh <github|gitlab> <number> <title-file> <body-file>`

Writes a corrected title/description to the PR/MR and verifies the change
landed by reading it back. Never touches the base branch.

## Parameters

| #   | Name       | Format             | Required | Notes                                                                                                                                                                            |
| --- | ---------- | ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | platform   | `github`/`gitlab`  | yes      | From `find-pr.sh`'s `platform:` line.                                                                                                                                            |
| 2   | number     | PR number / MR IID | yes      | From `find-pr.sh`'s `number:` line.                                                                                                                                              |
| 3   | title-file | path to a file     | yes      | The **corrected** title, written by the caller (e.g. via the `Write` tool) — a fresh file, not `find-pr.sh`'s `title_file` (that one holds the _current_, possibly-stale title). |
| 4   | body-file  | path to a file     | yes      | The **corrected** body/description, same provenance note as above.                                                                                                               |

## Exit codes

| Code | Meaning             | Notes                                                                                                                            |
| ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 0    | ok                  | Prints `applied: yes` / `verified: yes`.                                                                                         |
| 2    | usage               | Wrong platform/missing number, or `title-file`/`body-file` doesn't exist.                                                        |
| 3    | apply_failed        | The update call itself (`gh api -X PATCH` / `glab mr update`) failed.                                                            |
| 4    | verify_fetch_failed | Update succeeded but the read-back call failed — applied state is unconfirmed.                                                   |
| 5    | verify_mismatch     | Update call succeeded but the read-back title/body doesn't match what was written — flag for manual check, do not retry blindly. |
