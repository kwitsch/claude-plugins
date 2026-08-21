#!/usr/bin/env bash
# ship-ensure-mergeable.sh <platform> <branch> <base> <pr-id> — make the PR/MR
# mergeable before the Ship phase enters the ci-monitor loop, so CI actually
# starts. Reads the platform merge-state; if the branch is BEHIND its base it
# is updated/rebased via the platform's own API; if it has merge CONFLICTS they
# are auto-resolved locally with `git merge -X ours` (the PR/head branch wins
# every conflicting hunk) and non-force pushed. Any conflict shape `-X ours`
# cannot cleanly resolve (add/add, rename/modify, modify/delete, binary), and
# any API/CLI/push failure, bails out non-zero (blocked).
#
# It NEVER force-pushes (neither force nor force-with-lease), never merges the
# PR/MR itself, never enables auto-merge, and never retargets/touches the base.
#
# All git commands run in the caller's cwd (the worktree with the work branch
# checked out).
#
# Args:
#   1 platform  github | gitlab
#   2 branch    work / PR source branch
#   3 base      base branch (never modified)
#   4 pr-id     GitHub PR number / GitLab MR iid
#
# stdout (success): a final line `mergeState=<clean|rebased|resolved|unknown>`
#   clean    already up-to-date & mergeable, no action taken
#   rebased  was behind → platform update/rebase applied
#   resolved had conflicts → auto-resolved with -X ours & non-force pushed
#   unknown  merge-state indeterminate after retries → proceed anyway
#   All four mean: proceed into the ci-monitor loop.
# stderr (failure): a human-readable reason.
# Exit codes:
#   0   success (one mergeState value printed)
#   1   remediation mechanism failed → shipper reports status "blocked"
#   64  usage error (wrong argument count / unknown platform)
#
# Env overrides (mainly for tests):
#   SHIP_MERGE_POLL_INTERVAL  seconds between merge-state polls (default 5)
#   SHIP_MERGE_POLL_RETRIES   number of poll attempts            (default 3)
set -u

PLATFORM="${1:-}"
BRANCH="${2:-}"
BASE="${3:-}"
PR_ID="${4:-}"

RETRIES="${SHIP_MERGE_POLL_RETRIES:-3}"
SLEEP="${SHIP_MERGE_POLL_INTERVAL:-5}"

if [ "$#" -ne 4 ] || [ -z "$PLATFORM" ] || [ -z "$BRANCH" ] || [ -z "$BASE" ] || [ -z "$PR_ID" ]; then
  echo "usage: ship-ensure-mergeable.sh <github|gitlab> <branch> <base> <pr-id>" >&2
  exit 64
fi

case "$PLATFORM" in
  github | gitlab) ;;
  *)
    echo "unknown platform: $PLATFORM (expected github or gitlab)" >&2
    exit 64
    ;;
esac

fail() {
  echo "ship-ensure-mergeable: $1" >&2
  exit 1
}

# ── Classification: echo one of clean|behind|conflict|unknown ────────────────
classify_github() {
  local out rc mss mergeable i
  for ((i = 1; i <= RETRIES; i++)); do
    out="$(gh pr view "$PR_ID" --json mergeable,mergeStateStatus 2> /dev/null)"
    rc=$?
    if [ "$rc" -ne 0 ] || [ -z "$out" ]; then
      if [ "$i" -lt "$RETRIES" ]; then
        sleep "$SLEEP"
        continue
      fi
      echo unknown
      return 0
    fi
    mss="$(printf '%s' "$out" | jq -r '.mergeStateStatus // "UNKNOWN"')"
    mergeable="$(printf '%s' "$out" | jq -r '.mergeable // "UNKNOWN"')"
    if [ "$mss" = "DIRTY" ] || [ "$mergeable" = "CONFLICTING" ]; then
      echo conflict
      return 0
    fi
    if [ "$mss" = "BEHIND" ]; then
      echo behind
      return 0
    fi
    if [ "$mss" = "UNKNOWN" ] || [ "$mergeable" = "UNKNOWN" ]; then
      if [ "$i" -lt "$RETRIES" ]; then
        sleep "$SLEEP"
        continue
      fi
      echo unknown
      return 0
    fi
    echo clean
    return 0
  done
  echo unknown
}

classify_gitlab() {
  local out rc dms ms i
  for ((i = 1; i <= RETRIES; i++)); do
    out="$(glab api "projects/:id/merge_requests/$PR_ID" 2> /dev/null)"
    rc=$?
    if [ "$rc" -ne 0 ] || [ -z "$out" ]; then
      if [ "$i" -lt "$RETRIES" ]; then
        sleep "$SLEEP"
        continue
      fi
      echo unknown
      return 0
    fi
    dms="$(printf '%s' "$out" | jq -r '.detailed_merge_status // ""')"
    ms="$(printf '%s' "$out" | jq -r '.merge_status // ""')"
    if [ "$dms" = "conflict" ] || { [ -z "$dms" ] && [ "$ms" = "cannot_be_merged" ]; }; then
      echo conflict
      return 0
    fi
    if [ "$dms" = "need_rebase" ]; then
      echo behind
      return 0
    fi
    if [ "$dms" = "unchecked" ] || [ "$dms" = "checking" ] || { [ -z "$dms" ] && [ "$ms" = "unchecked" ]; }; then
      if [ "$i" -lt "$RETRIES" ]; then
        sleep "$SLEEP"
        continue
      fi
      echo unknown
      return 0
    fi
    echo clean
    return 0
  done
  echo unknown
}

classify() {
  if [ "$PLATFORM" = "github" ]; then classify_github; else classify_gitlab; fi
}

# ── behind remediation (platform update / rebase; non-force) ─────────────────
remediate_behind_github() {
  gh pr update-branch "$PR_ID" > /dev/null 2>&1 || fail "gh pr update-branch $PR_ID failed"
}

remediate_behind_gitlab() {
  glab api -X PUT "projects/:id/merge_requests/$PR_ID/rebase" > /dev/null 2>&1 \
    || fail "glab rebase API failed for MR $PR_ID"
  local i out rip merr
  for ((i = 1; i <= RETRIES; i++)); do
    sleep "$SLEEP"
    out="$(glab api "projects/:id/merge_requests/$PR_ID" 2> /dev/null)" || continue
    merr="$(printf '%s' "$out" | jq -r '.merge_error // "null"')"
    if [ -n "$merr" ] && [ "$merr" != "null" ]; then
      fail "GitLab rebase reported merge_error: $merr"
    fi
    rip="$(printf '%s' "$out" | jq -r '.rebase_in_progress // false')"
    [ "$rip" = "false" ] && return 0
  done
  return 0
}

remediate_behind() {
  if [ "$PLATFORM" = "github" ]; then remediate_behind_github; else remediate_behind_gitlab; fi
}

# ── conflict remediation (local -X ours merge, non-force push) ───────────────
remediate_conflict() {
  git fetch origin "$BASE" > /dev/null 2>&1 || fail "git fetch origin $BASE failed"
  if ! git merge --no-edit -X ours "origin/$BASE" > /dev/null 2>&1; then
    if [ -n "$(git ls-files --unmerged 2> /dev/null)" ]; then
      git merge --abort > /dev/null 2>&1
      fail "merge -X ours left unmerged paths (add/add, rename/modify, modify/delete, or binary conflict); aborted without force-picking a side"
    fi
    git merge --abort > /dev/null 2>&1 || true
    fail "git merge -X ours origin/$BASE failed"
  fi
  git push origin "$BRANCH" > /dev/null 2>&1 || fail "git push origin $BRANCH rejected (remote moved); not force-pushing"
  local c
  c="$(classify)"
  [ "$c" = "conflict" ] && fail "merge-state still conflicting after -X ours resolution and push"
  return 0
}

# ── Dispatch ─────────────────────────────────────────────────────────────────
class="$(classify)"
case "$class" in
  clean)
    echo "mergeState=clean"
    exit 0
    ;;
  unknown)
    echo "mergeState=unknown"
    exit 0
    ;;
  behind)
    remediate_behind
    class="$(classify)"
    if [ "$class" = "conflict" ]; then
      remediate_conflict
      echo "mergeState=resolved"
      exit 0
    fi
    echo "mergeState=rebased"
    exit 0
    ;;
  conflict)
    remediate_conflict
    echo "mergeState=resolved"
    exit 0
    ;;
  *)
    echo "mergeState=unknown"
    exit 0
    ;;
esac
