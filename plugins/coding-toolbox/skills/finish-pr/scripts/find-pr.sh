#!/usr/bin/env bash
# Detect the git host (gh vs glab), then look up the PR/MR for a branch and
# report its state. Read-only -- never mutates the PR/MR. Every outcome
# discoverable this way (found/not-found/open/closed/merged) is exit 0,
# carried on the printed lines; exit codes above 0 are hard errors nothing
# downstream should proceed past.
#
# Usage: find-pr.sh <branch> [github|gitlab]
# Exit: 0 ok - 2 usage - 3 cli_unavailable - 4 ambiguous_platform -
#       5 source_branch_mismatch (GitLab only)
set -uo pipefail

branch="${1:-}"
platform_override="${2:-}"
usage() { echo "usage: find-pr.sh <branch> [github|gitlab]" >&2; exit 2; }
[ -n "$branch" ] || usage
case "$platform_override" in
  ""|github|gitlab) ;;
  *) usage ;;
esac

# "anchor" match on the origin URL, same heuristic the skill body used to
# apply by eye: a hostname containing "github"/"gitlab" covers .com and
# Enterprise/self-managed hosts alike. A truly custom domain (neither
# substring) falls to the auth-status probe below.
detect_platform() {
  local url host gh_ok=no glab_ok=no
  url="$(git remote get-url origin 2>/dev/null)" || { echo "no origin remote configured" >&2; return 3; }
  case "$url" in
    *github*) echo github; return 0 ;;
    *gitlab*) echo gitlab; return 0 ;;
  esac
  host="$(printf '%s' "$url" | sed -E 's#^[A-Za-z]+://##; s#^[^@]*@##; s#[:/].*$##')"
  gh auth status --hostname "$host" >/dev/null 2>&1 && gh_ok=yes
  glab auth status --hostname "$host" >/dev/null 2>&1 && glab_ok=yes
  if [ "$gh_ok" = yes ] && [ "$glab_ok" = no ]; then echo github; return 0; fi
  if [ "$glab_ok" = yes ] && [ "$gh_ok" = no ]; then echo gitlab; return 0; fi
  echo "ambiguous host $host -- gh_ok=$gh_ok glab_ok=$glab_ok" >&2
  return 4
}

if [ -n "$platform_override" ]; then
  platform="$platform_override"
else
  platform="$(detect_platform)" || exit $?
fi

# Gate on CLI presence + auth *before* the lookup -- gh pr view / glab api
# both fail non-zero for "not found" and "dead token" alike, so checking
# auth first is the only way to tell those apart.
case "$platform" in
  github)
    command -v gh >/dev/null 2>&1 || { echo "gh not found on PATH -- install the GitHub CLI" >&2; exit 3; }
    gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated -- run: gh auth login" >&2; exit 3; }
    ;;
  gitlab)
    command -v glab >/dev/null 2>&1 || { echo "glab not found on PATH -- install the GitLab CLI" >&2; exit 3; }
    glab auth status >/dev/null 2>&1 || { echo "glab is not authenticated -- run: glab auth login" >&2; exit 3; }
    ;;
esac

found=no state="" number="" pr_url="" base="" draft="" head_sha="" \
  should_remove_source_branch="n/a" force_remove_source_branch="n/a" \
  title_file="" body_file=""

if [ "$platform" = github ]; then
  resp="$(gh pr view "$branch" --json number,state,url,title,body,baseRefName,isDraft,headRefOid 2>/dev/null)"
  if [ -n "$resp" ]; then
    found=yes
    number="$(printf '%s' "$resp" | jq -r '.number')"
    pr_url="$(printf '%s' "$resp" | jq -r '.url')"
    base="$(printf '%s' "$resp" | jq -r '.baseRefName')"
    draft="$(printf '%s' "$resp" | jq -r '.isDraft')"
    head_sha="$(printf '%s' "$resp" | jq -r '.headRefOid')"
    case "$(printf '%s' "$resp" | jq -r '.state')" in
      OPEN) state=open ;;
      CLOSED) state=closed ;;
      MERGED) state=merged ;;
    esac
    # Only the open path ever reaches the reconcile step that reads these --
    # skip the mktemp entirely for merged/closed so a report-and-stop run
    # never leaves two unread temp files behind.
    if [ "$state" = open ]; then
      title_file="$(mktemp)" || { echo "mktemp failed -- check TMPDIR" >&2; exit 3; }
      body_file="$(mktemp)" || { echo "mktemp failed -- check TMPDIR" >&2; exit 3; }
      printf '%s' "$resp" | jq -r '.title' > "$title_file"
      printf '%s' "$resp" | jq -r '.body' > "$body_file"
    fi
  fi
else
  encoded_branch="$(jq -rn --arg b "$branch" '$b|@uri')"
  resp="$(glab api "projects/:id/merge_requests?source_branch=$encoded_branch&state=opened" 2>/dev/null | jq -c '.[0] // empty')"
  if [ -z "$resp" ]; then
    resp="$(glab api "projects/:id/merge_requests?source_branch=$encoded_branch&state=all" 2>/dev/null | jq -c '.[0] // empty')"
  fi
  if [ -n "$resp" ]; then
    actual_source_branch="$(printf '%s' "$resp" | jq -r '.source_branch')"
    if [ "$actual_source_branch" != "$branch" ]; then
      echo "matched MR's source_branch ($actual_source_branch) does not equal $branch -- refusing to trust this result" >&2
      exit 5
    fi
    found=yes
    number="$(printf '%s' "$resp" | jq -r '.iid')"
    pr_url="$(printf '%s' "$resp" | jq -r '.web_url')"
    base="$(printf '%s' "$resp" | jq -r '.target_branch')"
    draft="$(printf '%s' "$resp" | jq -r 'if .draft != null then .draft else .work_in_progress end')"
    head_sha="$(printf '%s' "$resp" | jq -r '.sha')"
    should_remove_source_branch="$(printf '%s' "$resp" | jq -r '.should_remove_source_branch')"
    force_remove_source_branch="$(printf '%s' "$resp" | jq -r '.force_remove_source_branch')"
    case "$(printf '%s' "$resp" | jq -r '.state')" in
      opened) state=open ;;
      closed) state=closed ;;
      merged) state=merged ;;
    esac
    if [ "$state" = open ]; then
      title_file="$(mktemp)" || { echo "mktemp failed -- check TMPDIR" >&2; exit 3; }
      body_file="$(mktemp)" || { echo "mktemp failed -- check TMPDIR" >&2; exit 3; }
      printf '%s' "$resp" | jq -r '.title' > "$title_file"
      printf '%s' "$resp" | jq -r '.description' > "$body_file"
    fi
  fi
fi

printf 'platform: %s\nfound: %s\nstate: %s\nnumber: %s\nurl: %s\nbase: %s\ndraft: %s\nhead_sha: %s\nshould_remove_source_branch: %s\nforce_remove_source_branch: %s\ntitle_file: %s\nbody_file: %s\n' \
  "$platform" "$found" "$state" "$number" "$pr_url" "$base" "$draft" "$head_sha" \
  "$should_remove_source_branch" "$force_remove_source_branch" "$title_file" "$body_file"
exit 0
