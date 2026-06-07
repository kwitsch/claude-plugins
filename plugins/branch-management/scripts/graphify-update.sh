#!/usr/bin/env bash
# graphify-update.sh [--force] [--keep-user-files] — refresh the graphify
# output of the current repository.
#
# Runs `graphify update .` from the repository root (resolved
# via git, so the caller's cwd does not matter). Without --force the update
# only runs when graphify-out/ already exists; with --force a missing folder
# is created first. The graphify output serves agents: human-only artifacts
# (graph.html) are pruned after the update unless --keep-user-files is given.
#
# Exit codes: 0 update ran
#             1 usage error or not inside a git repository
#             2 graphify CLI not installed
#             4 update run failed (timeout, crash)
#             5 graphify-out/ missing and --force not given
set -euo pipefail

force=0
keep_user_files=0
while [ $# -gt 0 ]; do
  case "$1" in
    --force) force=1 ;;
    --keep-user-files) keep_user_files=1 ;;
    *)
      echo "usage: graphify-update.sh [--force] [--keep-user-files]" >&2
      exit 1
      ;;
  esac
  shift
done

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
timeout -k 10 "${GRAPHIFY_TIMEOUT:-600}" graphify update . || exit 4

# 5) Prune human-only artifacts — the graphify output here serves agents
#    (graph.json, GRAPH_REPORT.md); graph.html is browser-only.
if [ "$keep_user_files" -eq 0 ]; then
  rm -f graphify-out/graph.html
fi
