#!/usr/bin/env bash
# coderabbit-review.sh <base-branch> — non-interactive CodeRabbit review of
# the current branch against <base-branch>.
#
# --prompt-only is the agent-optimized plain output (runs a full review).
# The exit codes of `auth status` and `review` are not contractually
# documented, so login is judged from the auth output and findings from the
# review output, never from the review exit code alone.
#
# Exit codes: 0 review ran (stdout = raw review output)
#             2 coderabbit CLI not installed (checks the `cr` alias too)
#             3 not logged in
#             4 review run failed (timeout, rate limit, crash)
set -euo pipefail

base="${1:?usage: coderabbit-review.sh <base-branch>}"

# 1) Presence — `cr` is the documented alias.
if command -v coderabbit >/dev/null 2>&1; then bin=coderabbit
elif command -v cr >/dev/null 2>&1; then bin=cr
else exit 2; fi

# 2) Login — "Not logged in" also contains "logged in", so check the negative
# first, then require a positive signal.
status_out="$("$bin" auth status 2>&1 || true)"
printf '%s' "$status_out" | grep -qiE 'not[a-z ,-]{0,30}(logged|authenticated)|no longer (logged|authenticated)|session expired|login required' && exit 3
printf '%s' "$status_out" | grep -qiE 'logged in|authenticated' || exit 3

# 3) Review
timeout -k 10 "${REVIEW_TIMEOUT:-600}" "$bin" review --prompt-only --base "$base" || exit 4
