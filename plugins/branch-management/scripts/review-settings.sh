#!/usr/bin/env bash
# review-settings.sh [settings-file] — print the new-pr review toggles, one
# `<tool>=true|false` line each for claude, codex, copilot and coderabbit.
#
# Source: the `reviews:` block in the YAML frontmatter of
# .claude/branch-management.local.md (default location: the git toplevel,
# outside a repo: $PWD). Fail-open: only an explicit `false` (surrounding
# quotes tolerated) disables a review — a missing file, missing block,
# missing key or any other value keeps it enabled. Inline comments after
# the value are not supported (the value would not match `false`).
# Reviews are a safety net; a broken settings file must not silently
# switch them off.
#
# Exit codes: 0 always (query, not a gate) · 1 usage error
set -euo pipefail

[ "$#" -le 1 ] || { echo "usage: review-settings.sh [settings-file]" >&2; exit 1; }

file="${1:-}"
if [ -z "$file" ]; then
  root=$(git rev-parse --show-toplevel 2>/dev/null) || root="$PWD"
  file="$root/.claude/branch-management.local.md"
fi

if [ ! -f "$file" ]; then
  printf 'claude=true\ncodex=true\ncopilot=true\ncoderabbit=true\n'
  exit 0
fi

awk '
  BEGIN { val["claude"] = val["codex"] = val["copilot"] = val["coderabbit"] = "true" }
  NR == 1 && $0 !~ /^---[[:space:]]*$/ { exit }  # no frontmatter at all
  NR == 1 { next }                               # opening ---
  /^---[[:space:]]*$/ { exit }                   # closing --- ends the frontmatter
  /^[^[:space:]]/ { in_reviews = ($0 ~ /^reviews:[[:space:]]*$/); next }
  in_reviews && /^[[:space:]]+(claude|codex|copilot|coderabbit):/ {
    key = $0; sub(/^[[:space:]]+/, "", key); sub(/:.*$/, "", key)
    v = $0; sub(/^[^:]*:[[:space:]]*/, "", v); sub(/[[:space:]]+$/, "", v)
    if (v == "false" || v == "\"false\"" || v == "\047false\047") val[key] = "false"
  }
  END {
    printf "claude=%s\ncodex=%s\ncopilot=%s\ncoderabbit=%s\n",
      val["claude"], val["codex"], val["copilot"], val["coderabbit"]
  }
' "$file"
