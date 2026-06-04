#!/usr/bin/env bash
# codex-review.sh <base-branch> — non-interactive Codex review of the current
# branch against origin/<base-branch>.
#
# Codex has no non-interactive review subcommand (/review is TUI-only); the
# official headless mode is `codex exec`, so the diff logic lives in the
# prompt and --sandbox read-only guarantees nothing is modified.
#
# Exit codes: 0 review ran (stdout = raw review output)
#             2 codex CLI not installed
#             3 not logged in
#             4 review run failed (timeout, rate limit, crash)
set -euo pipefail

base="${1:?usage: codex-review.sh <base-branch>}"

# 1) Presence
command -v codex >/dev/null 2>&1 || exit 2

# 2) Login — documented: `codex login status` exits 0 when logged in.
codex login status >/dev/null 2>&1 || exit 3

# 3) Review
timeout "${REVIEW_TIMEOUT:-600}" codex exec --skip-git-repo-check \
  --sandbox read-only --color never \
  "Review the changes on the current branch against base branch origin/${base}.
Run: git diff \"origin/${base}...HEAD\" and inspect the changed files as needed.
Report prioritized findings, each with: file, line, severity (critical/major/minor), a short title, a description and a concrete recommendation.
Do not modify any files." || exit 4
