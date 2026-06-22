#!/usr/bin/env bash
# clean-branches.sh — fetch, prune merged upstream branches (gh/glab),
# remove stale local branches whose upstream is gone, and list uncommitted files.
# stdout: human-readable lists of deleted branches and uncommitted files (silent when nothing to report).
# Exit codes: 0 always (individual git/push failures are silently skipped).
# No arguments.
set -uo pipefail

_deleted_upstream=()
_deleted_local=()
_force_deleted_local=()

# ── Step 1: fetch + prune stale remote-tracking refs ──────────────────
git fetch --prune

# ── Step 2: delete merged upstream branches (requires gh or glab) ─────
# Delete every origin/* branch already merged into the default branch; appends names to _deleted_upstream.
_delete_merged_upstream() {
    local default_branch
    # try local symref first; fall back to querying remote (network call)
    local _symref
    _symref=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null)
    default_branch="${_symref#refs/remotes/origin/}"
    if [ -z "$default_branch" ]; then
        default_branch=$(git remote show origin 2>/dev/null \
            | awk '/HEAD branch/ {print $NF}')
    fi
    [ -z "$default_branch" ] && return 1

    local merged_branches
    local _raw_merged
    _raw_merged=$(git branch -r --merged "origin/$default_branch") || return 0

    # In one awk pass: drop the symref line (origin/HEAD -> ...), skip refs from
    # other remotes (only origin/* may be push-deleted on origin — upstream/foo
    # would otherwise be passed verbatim to `git push origin --delete`), strip
    # leading whitespace + "origin/" prefix, then exclude the default branch by
    # EXACT name match (substring greps wrongly dropped e.g. "origin/main-backup").
    merged_branches=$(printf '%s\n' "$_raw_merged" \
        | awk -v def="$default_branch" '
            /->/ { next }
            !/^[[:space:]]*origin\// { next }
            { sub(/^[[:space:]]*origin\//, "") }
            $0 == def { next }
            $0 != "" { print }') || return 0

    [ -z "$merged_branches" ] && return 0

    while IFS= read -r branch; do
        if git push origin --delete "$branch" >/dev/null 2>&1; then
            _deleted_upstream+=("$branch")
        fi
    done <<< "$merged_branches"
}

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    _delete_merged_upstream || true
elif command -v glab >/dev/null 2>&1 && glab auth status >/dev/null 2>&1; then
    _delete_merged_upstream || true
fi

if [ ${#_deleted_upstream[@]} -gt 0 ]; then
    echo "Deleted upstream branches:"
    printf '  %s\n' "${_deleted_upstream[@]}"
fi

# ── Step 3: delete local branches whose upstream is gone ──────────────
# Read the tracking field directly via for-each-ref rather than greping
# `git branch -vv` output: ': gone]' there also matches a commit subject, so a
# branch with a healthy upstream but that text in its subject would be deleted.
# $NF == "[gone]" tests only the upstream:track column; $1 != cur drops the
# current branch (git refuses to delete it; empty cur on detached HEAD is fine).
current=$(git symbolic-ref --short HEAD 2>/dev/null)
gone_branches=$(git for-each-ref --format '%(refname:short) %(upstream:track)' refs/heads/ \
    | awk -v cur="$current" '$NF == "[gone]" && $1 != cur {print $1}') || true

if [ -n "$gone_branches" ]; then
    while IFS= read -r branch; do
        [ -z "$branch" ] && continue
        # Prefer the safe -d (refuses unmerged work). A gone upstream means the
        # remote branch was deleted, not necessarily that the work was merged
        # (e.g. a PR closed without merging), so force-deleting silently can
        # destroy commits that exist nowhere else. Fall back to -D but record
        # those branches separately so the loss is visible.
        if git branch -d "$branch" 2>/dev/null; then
            _deleted_local+=("$branch")
        elif git branch -D "$branch" 2>/dev/null; then
            _force_deleted_local+=("$branch")
        fi
    done <<< "$gone_branches"
fi

if [ ${#_deleted_local[@]} -gt 0 ]; then
    echo "Deleted local branches (upstream gone):"
    printf '  %s\n' "${_deleted_local[@]}"
fi

if [ ${#_force_deleted_local[@]} -gt 0 ]; then
    echo "Force-deleted (had unmerged commits):"
    printf '  %s\n' "${_force_deleted_local[@]}"
fi

# ── Step 4: list uncommitted files ────────────────────────────────────
# Note: git status --porcelain excludes gitignored files; $2 is the path
# field (simple paths only — renames show "old -> new", both are visible).
# core.quotePath=false makes paths with non-ASCII bytes or embedded quotes
# print literally instead of C-quoted (the default).
uncommitted=$(git -c core.quotePath=false status --porcelain) || true

if [ -n "$uncommitted" ]; then
    echo "Uncommitted files:"
    git -c core.quotePath=false status --porcelain | awk '{print "  " substr($0,4)}'
fi
