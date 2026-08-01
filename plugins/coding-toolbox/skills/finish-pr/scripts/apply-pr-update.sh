#!/usr/bin/env bash
# Apply a corrected title/description to an existing PR/MR, then verify by
# reading it back. Title/body are always read from files -- never accepted
# as argv or inlined into a command string -- so contributor-controlled
# PR/MR content already on disk never gets shell-re-parsed regardless of
# what it contains ($()/backticks/quotes included).
#
# Usage: apply-pr-update.sh <github|gitlab> <number> <title-file> <body-file>
# Exit: 0 ok (applied + verified) - 2 usage - 3 apply_failed -
#       4 verify_fetch_failed - 5 verify_mismatch
set -uo pipefail

usage() { echo "usage: apply-pr-update.sh <github|gitlab> <number> <title-file> <body-file>" >&2; exit 2; }
platform="${1:-}"; number="${2:-}"; title_file="${3:-}"; body_file="${4:-}"
case "$platform" in github|gitlab) ;; *) usage ;; esac
[ -n "$number" ] || usage
[ -f "$title_file" ] || { echo "title file not found: $title_file" >&2; exit 2; }
[ -f "$body_file" ] || { echo "body file not found: $body_file" >&2; exit 2; }

if [ "$platform" = github ]; then
  gh api -X PATCH "repos/{owner}/{repo}/pulls/$number" -F title=@"$title_file" -F body=@"$body_file" >/dev/null 2>&1 \
    || { echo "gh api PATCH pulls/$number failed" >&2; exit 3; }
  resp="$(gh api "repos/{owner}/{repo}/pulls/$number" 2>/dev/null)"
  [ -n "$resp" ] || { echo "failed to re-fetch PR $number for verification" >&2; exit 4; }
  actual_title="$(printf '%s' "$resp" | jq -r '.title')"
  actual_body="$(printf '%s' "$resp" | jq -r '.body')"
else
  title="$(cat "$title_file")"
  body="$(cat "$body_file")"
  glab mr update "$number" --title "$title" --description "$body" >/dev/null 2>&1 \
    || { echo "glab mr update $number failed" >&2; exit 3; }
  resp="$(glab api "projects/:id/merge_requests/$number" 2>/dev/null)"
  [ -n "$resp" ] || { echo "failed to re-fetch MR $number for verification" >&2; exit 4; }
  actual_title="$(printf '%s' "$resp" | jq -r '.title')"
  actual_body="$(printf '%s' "$resp" | jq -r '.description')"
fi

expected_title="$(cat "$title_file")"
expected_body="$(cat "$body_file")"
if [ "$actual_title" != "$expected_title" ] || [ "$actual_body" != "$expected_body" ]; then
  echo "verification mismatch after update" >&2
  exit 5
fi

printf 'applied: yes\nverified: yes\n'
exit 0
