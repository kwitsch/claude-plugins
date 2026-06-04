#!/usr/bin/env bash
# copilot-review.sh <base-branch> — non-interactive GitHub Copilot review of
# the current branch against origin/<base-branch>.
#
# Copilot CLI (public preview) has no non-interactive auth-status command and
# no documented process exit codes, so: login is a heuristic (documented token
# env precedence COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN, or login
# state under COPILOT_HOME), and auth failures during the run are detected
# from the output.
#
# Exit codes: 0 review ran (stdout = raw review output)
#             2 copilot CLI not installed
#             3 not logged in
#             4 review run failed (timeout, rate limit, crash)
set -euo pipefail

base="${1:?usage: copilot-review.sh <base-branch>}"

# 1) Presence
command -v copilot >/dev/null 2>&1 || exit 2

# 2) Login heuristic
if [ -z "${COPILOT_GITHUB_TOKEN:-}" ] && [ -z "${GH_TOKEN:-}" ] \
   && [ -z "${GITHUB_TOKEN:-}" ] && [ ! -d "${COPILOT_HOME:-$HOME/.copilot}" ]; then
  exit 3
fi

# 3) Review — documented programmatic pattern, tool permission tightly scoped
# to git. Copilot's exit codes are undocumented and auth errors can surface in
# either stream regardless of exit code, so both paths sniff a narrow auth
# pattern (deliberately without bare 'unauthorized', which legitimate review
# findings often contain).
auth_re='not (logged in|authenticated)|authentication (required|failed)|run /login'
err="$(mktemp)"
trap 'rm -f "$err"' EXIT
if ! out="$(timeout -k 10 "${REVIEW_TIMEOUT:-600}" copilot \
    -p "/review the changes on this branch compared to origin/${base}. Focus on bugs and security issues. Report each finding with file, line, severity (critical/major/minor), a short title and a concrete recommendation." \
    -s --no-ask-user --allow-tool='shell(git:*)' 2>"$err")"; then
  if { cat "$err"; printf '%s' "$out"; } | grep -qiE "$auth_re"; then
    exit 3
  fi
  { cat "$err"; printf '%s\n' "$out"; } >&2
  exit 4
fi
# Short auth-error replies can come back with exit 0; real review output is
# long, so only short outputs are sniffed.
if [ "${#out}" -lt 400 ] && printf '%s' "$out" | grep -qiE "$auth_re"; then
  exit 3
fi
printf '%s\n' "$out"
