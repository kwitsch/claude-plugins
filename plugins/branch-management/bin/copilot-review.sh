#!/usr/bin/env bash
# copilot-review.sh <base-branch> — non-interactive GitHub Copilot review of
# the current branch against origin/<base-branch>.
#
# Copilot CLI has no non-interactive auth-status command and no documented
# process exit codes, so: login is a heuristic (documented token env
# precedence COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN, a recorded login
# in COPILOT_HOME's config.json, or gh CLI credentials), and auth failures
# during the run are detected from the output.
#
# Exit codes: 0 review ran (stdout = raw review output)
#             2 copilot CLI not installed
#             3 not logged in
#             4 review run failed (timeout, rate limit, crash)
set -euo pipefail

base="${1:?usage: copilot-review.sh <base-branch>}"

# 1) Presence — `copilot` is the only binary name; `cr` is CodeRabbit's alias, not Copilot's.
command -v copilot >/dev/null 2>&1 || exit 2

# 2) Login heuristic. A fresh COPILOT_HOME is created on first launch with
# only a firstLaunchAt stamp, so directory existence alone proves nothing.
# Logged in means: a token env var, a copilot login recorded in config.json
# (a non-empty loggedInUsers array — present even when the token itself lives
# in the system credential store), or gh CLI credentials (copilot falls back
# to the gh credential store; verified against CLI 1.0.60).
cfg="${COPILOT_HOME:-$HOME/.copilot}/config.json"
gh_hosts="${GH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/gh}/hosts.yml"
# Whitespace-normalize so the match survives both pretty-printed and minified
# JSON; '"loggedInUsers":[{' only appears when the array is non-empty.
has_copilot_login() {
  [ -f "$cfg" ] && awk '{gsub(/[ \t\r]/, ""); s = s $0}
    END {exit (index(s, "\"loggedInUsers\":[{") ? 0 : 1)}' "$cfg"
}
# gh records a logged-in host in hosts.yml as a `<host>:` block carrying a
# `user:` line. The OAuth token only appears inline (`oauth_token:`) under
# insecure storage; gh's default secure storage keeps it in the OS keyring,
# so match the always-present `user:` line, not the token (gh ≥ 2.26).
has_gh_login() {
  [ -f "$gh_hosts" ] && grep -qE '^[[:space:]]*user:[[:space:]]*[^[:space:]]' "$gh_hosts"
}
if [ -z "${COPILOT_GITHUB_TOKEN:-}" ] && [ -z "${GH_TOKEN:-}" ] \
   && [ -z "${GITHUB_TOKEN:-}" ] && ! has_copilot_login && ! has_gh_login; then
  exit 3
fi

# 3) Review — documented programmatic pattern, hardened read-only on three
# layers: the write tool is denied (denial rules beat every allow rule); the
# shell allowlist names only read-only git subcommands (shell(git:*) would also
# match write-path subcommands like "git commit", verified against CLI 1.0.60);
# and a git facade (bin/git-shim) is prepended to copilot's PATH so even
# the allowed subcommands cannot write via the --output/-O flag family, which
# the per-subcommand allowlist cannot express. Reading and searching the
# worktree need no allows: the internal read/search tools run without approval.
# Copilot's exit codes are undocumented and auth errors can surface in either
# stream regardless of exit code, so both paths sniff a narrow auth pattern
# (deliberately without bare 'unauthorized', which legitimate findings carry).
auth_re='not (logged in|authenticated)|authentication (required|failed)|run /login'
err="$(mktemp)"
trap 'rm -f "$err"' EXIT

# Read-only git facade: real git resolved before the shim shadows it, exported
# so the shim can forward to it. Skipped only if git is absent (then copilot's
# own git calls fail regardless). ${BASH_SOURCE%/*} avoids a dirname dependency.
real_git="$(command -v git || true)"
shim_path=""
if [ -n "$real_git" ]; then
  shim_path="${BASH_SOURCE[0]%/*}/git-shim"
fi

if ! out="$(COPILOT_REVIEW_REAL_GIT="$real_git" \
    PATH="${shim_path:+$shim_path:}$PATH" \
    timeout -k 10 "${REVIEW_TIMEOUT:-600}" copilot \
    -p "/review the changes on this branch compared to origin/${base}. Focus on bugs and security issues. Report each finding with file, line, severity (critical/major/minor), a short title and a concrete recommendation." \
    -s --no-ask-user --deny-tool write \
    --allow-tool='shell(git diff)' --allow-tool='shell(git log)' \
    --allow-tool='shell(git show)' --allow-tool='shell(git status)' \
    --allow-tool='shell(git merge-base)' --allow-tool='shell(git rev-parse)' \
    --allow-tool='shell(git grep)' --allow-tool='shell(git blame)' \
    --allow-tool='shell(git ls-files)' \
    2>"$err")"; then
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
