#!/usr/bin/env bash
# graphify-update.sh [--force] — refresh the graphify output of the current
# repository.
#
# Runs `graphify update -o graphify-out` from the repository root (resolved
# via git, so the caller's cwd does not matter). Without --force the update
# only runs when graphify-out/ already exists; with --force a missing folder
# is created first.
#
# Exit codes: 0 update ran
#             2 graphify CLI not installed
#             4 update run failed (timeout, crash)
#             5 graphify-out/ missing and --force not given
set -euo pipefail

force=0
if [ "${1:-}" = "--force" ]; then force=1; shift; fi
if [ $# -gt 0 ]; then
  echo "usage: graphify-update.sh [--force]" >&2
  exit 1
fi

# 1) Repo root — graphify-out lives at the repository root regardless of cwd.
root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "usage: graphify-update.sh must run inside a git repository" >&2
  exit 1
}
cd "$root"

# 2) Presence
command -v graphify >/dev/null 2>&1 || exit 2

# 3) Output folder guard — only --force may create a missing graphify-out/.
if [ ! -d graphify-out ]; then
  [ "$force" -eq 1 ] || exit 5
  mkdir -p graphify-out
fi

# 4) Update
timeout -k 10 "${GRAPHIFY_TIMEOUT:-600}" graphify update -o graphify-out || exit 4
