# CLAUDE.md — branch-management

Two prompt-only skills covering the branch lifecycle: `new-branch` (start
work) and `new-pr` (submit work).

## Behavior
- `skills/new-branch`: refuses to run on a dirty tree; refreshes the
  clone-time `origin/HEAD` (`git remote set-head origin --auto`) before
  detecting the default branch (fallback `git remote show origin`), pulls
  with `--ff-only`, then creates `<type>/<slug>` — guarding against an
  already-existing branch name. Optional last step: invoke
  `context-mode:ctx-index` when that plugin is installed.
- `skills/new-pr`: aborts on detached HEAD or when already on the base
  branch; runs `git fetch origin` + `set-head --auto` first and uses
  `origin/<base>` for every git revision (a local base branch may be stale or
  missing — only `gh`/`glab` get the bare name). Review pipeline:
  `code-review --fix` (its default branch-diff scope), then `/copilot:review
  --base` and `/coderabbit:review --base` when those plugins are installed.
  Fixes are committed after each stage so later reviewers see them; findings
  are verified before fixing, never blindly applied. Then: ensure a clean
  tree, push, and `gh pr create` / `glab mr create` chosen from the `origin`
  URL.
- Missing optional plugins are skipped silently; a missing/unauthenticated
  `gh`/`glab` stops with the manual command instead.

## Tests
Prompt-only plugin — no executable hooks, so no bats suite. CI validates the
manifests only.
