# finalize-pr — script reference

**Invoke:** `bash ${CLAUDE_SKILL_DIR}/scripts/finalize-pr.sh <github|gitlab> <number> <yes|no>`

Undrafts the PR/MR if it's currently a draft, then — GitLab only — enables
delete-source-branch-on-merge if it's off. GitHub has no per-PR equivalent,
so that half is a no-op there.

## Parameters

| #   | Name     | Format             | Required | Notes                                                                                                                  |
| --- | -------- | ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | platform | `github`/`gitlab`  | yes      | From `find-pr.sh`'s `platform:` line.                                                                                  |
| 2   | number   | PR number / MR IID | yes      | From `find-pr.sh`'s `number:` line.                                                                                    |
| 3   | draft    | `yes`/`no`         | yes      | From `find-pr.sh`'s `draft:` line (`true`/`false` → `yes`/`no`). Only ever calls the ready/undraft command when `yes`. |

## Exit codes

| Code | Meaning        | Notes                                                                               |
| ---- | -------------- | ----------------------------------------------------------------------------------- |
| 0    | ok             | Prints `draft_before:`/`draft_after:`/`delete_source_branch:` lines.                |
| 2    | usage          | Wrong platform/missing number/draft not `yes`\|`no`.                                |
| 3    | undraft_failed | `gh pr ready`/`glab mr update --ready` failed.                                      |
| 4    | refetch_failed | GitLab only: re-fetching the MR's fresh `should_remove_source_branch` state failed. |
| 5    | toggle_failed  | GitLab only: `glab mr update --remove-source-branch` failed.                        |

## Output (stdout, on exit 0)

```text
draft_before: yes|no
draft_after: yes|no
delete_source_branch: n/a|already_on|forced|enabled
```

`delete_source_branch` is `n/a` on GitHub; `forced` means the project
already forces removal regardless of the per-MR flag; `already_on` means
the per-MR flag was already `true`; `enabled` means this call flipped it on.
**Never call this script a second time expecting `enabled` again** —
`--remove-source-branch` toggles the setting, it does not set it to a fixed
value, so a second call on an already-`enabled` MR would flip it back off.
