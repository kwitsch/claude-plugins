#!/usr/bin/env bash
# clean-branches: fetch, prune merged upstream branches (gh/glab),
# remove stale local tracking branches, list uncommitted files.
set -uo pipefail

_deleted_upstream=()
_deleted_local=()

# ── Step 1: fetch + prune stale remote-tracking refs ──────────────────
git fetch --prune

# ── Step 2: delete merged upstream branches (requires gh or glab) ─────
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
    _raw_merged=$(git branch -r --merged "origin/$default_branch" \
        | grep -v "origin/$default_branch" \
        | grep -v 'HEAD') || return 0

    # strip leading whitespace and "origin/" prefix using awk (no sed needed)
    merged_branches=$(printf '%s\n' "$_raw_merged" \
        | awk '{sub(/^[[:space:]]*origin\//,""); if($0!="") print}') || return 0

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
gone_branches=$(git branch -vv | grep ': gone]' | grep -v '^\*' \
    | awk '{print $1}') || true

if [ -n "$gone_branches" ]; then
    while IFS= read -r branch; do
        [ -z "$branch" ] && continue
        if git branch -d "$branch" 2>/dev/null \
            || git branch -D "$branch" 2>/dev/null; then
            _deleted_local+=("$branch")
        fi
    done <<< "$gone_branches"
fi

if [ ${#_deleted_local[@]} -gt 0 ]; then
    echo "Deleted local branches (upstream gone):"
    printf '  %s\n' "${_deleted_local[@]}"
fi

# ── Step 4: list uncommitted files ────────────────────────────────────
# Note: git status --porcelain excludes gitignored files; $2 is the path
# field (simple paths only — renames show "old -> new", both are visible).
uncommitted=$(git status --porcelain) || true

if [ -n "$uncommitted" ]; then
    echo "Uncommitted files:"
    git status --porcelain | awk '{print "  " $2}'
fi
