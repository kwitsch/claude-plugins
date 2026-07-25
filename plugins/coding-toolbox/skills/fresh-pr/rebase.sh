#!/usr/bin/env bash
# Rebase the work branch onto the latest origin/<base>. Run from the work
# tree. Always exits 0; outcome on the REBASE_RESULT= line.
set -uo pipefail
base="${1:?usage: <base>}"
if [ -n "$(git status --porcelain)" ]; then echo "REBASE_RESULT=skipped_dirty"; exit 0; fi
if ! out="$(git fetch origin "$base" 2>&1)"; then
  echo "REBASE_RESULT=failed"; echo "DETAIL=fetch: $(printf '%s' "$out" | tail -2 | tr '\n' ' ' | cut -c1-200)"; exit 0
fi
if git merge-base --is-ancestor "origin/$base" HEAD; then
  echo "REBASE_RESULT=up_to_date"; exit 0
fi
if git rebase "origin/$base" >/dev/null 2>&1; then
  echo "REBASE_RESULT=rebased"
else
  git rebase --abort >/dev/null 2>&1 || true
  echo "REBASE_RESULT=conflict"
fi
exit 0
