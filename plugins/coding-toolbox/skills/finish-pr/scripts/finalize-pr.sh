#!/usr/bin/env bash
# Undraft a PR/MR if it's a draft, then (GitLab only) enable delete-source-
# branch-on-merge if it's currently off -- re-fetching the MR's own state
# fresh first, since an undraft call just above can make a stale snapshot
# wrong. No per-PR equivalent exists on GitHub, so that half is skipped
# there entirely.
#
# Usage: finalize-pr.sh <github|gitlab> <number> <draft: yes|no>
# Exit: 0 ok - 2 usage - 3 undraft_failed - 4 refetch_failed (gitlab) -
#       5 toggle_failed (gitlab)
set -uo pipefail

usage() { echo "usage: finalize-pr.sh <github|gitlab> <number> <yes|no>" >&2; exit 2; }
platform="${1:-}"; number="${2:-}"; draft="${3:-}"
case "$platform" in github|gitlab) ;; *) usage ;; esac
[ -n "$number" ] || usage
case "$draft" in yes|no) ;; *) usage ;; esac

draft_after="$draft"
if [ "$draft" = yes ]; then
  if [ "$platform" = github ]; then
    gh pr ready "$number" >/dev/null 2>&1 || { echo "gh pr ready $number failed" >&2; exit 3; }
  else
    glab mr update "$number" --ready >/dev/null 2>&1 || { echo "glab mr update $number --ready failed" >&2; exit 3; }
  fi
  draft_after=no
fi

delete_source_branch="n/a"
if [ "$platform" = gitlab ]; then
  fresh="$(glab api "projects/:id/merge_requests/$number" 2>/dev/null | jq -c '{should_remove_source_branch, force_remove_source_branch}')"
  [ -n "$fresh" ] || { echo "failed to re-fetch MR $number state" >&2; exit 4; }
  force="$(printf '%s' "$fresh" | jq -r '.force_remove_source_branch')"
  should="$(printf '%s' "$fresh" | jq -r '.should_remove_source_branch')"
  if [ "$force" = true ]; then
    delete_source_branch="forced"
  elif [ "$should" = true ]; then
    delete_source_branch="already_on"
  else
    glab mr update "$number" --remove-source-branch >/dev/null 2>&1 \
      || { echo "glab mr update $number --remove-source-branch failed" >&2; exit 5; }
    delete_source_branch="enabled"
  fi
fi

printf 'draft_before: %s\ndraft_after: %s\ndelete_source_branch: %s\n' "$draft" "$draft_after" "$delete_source_branch"
exit 0
