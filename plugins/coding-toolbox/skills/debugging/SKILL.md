---
name: debugging
description: >-
  Runs fresh-work's fix-path debugging pipeline: root cause before any fix,
  a failing test first, a single targeted change, then verify. Invoked by
  fresh-work after it classifies work as a fix and cuts the branch — assumes
  a work branch is already checked out.
argument-hint: "[bug-description]"
arguments: work_description
allowed-tools: ["Read", "Edit", "Write", "Grep", "Glob", "Bash", "ToolSearch"]
---

# debugging

Runs fresh-work's fix-path debugging pipeline — invoked by `fresh-work` after
it classifies work as `fix` and cuts the branch. Assumes a work branch is
already checked out.

`$work_description` is the bug description, passed through unchanged from
`fresh-work`.

## Steps

1. **Debug.** Read `references/debugging.md`; root cause → failing test → fix
   → verify, all committed on the current branch. Return to the caller
   (`fresh-work`) once the fix is verified and committed (or report "nothing
   to fix" with evidence) — do not open a PR; opening the PR is
   `fresh-work`'s job, run after this skill returns. Terminal step.
