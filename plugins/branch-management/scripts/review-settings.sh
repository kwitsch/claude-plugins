#!/usr/bin/env bash
# review-settings.sh [settings-file] — print the new-pr review toggles, one
# `<tool>=true|false` line each for claude, codex, copilot and coderabbit.
#
# Source: the top-level block-style `reviews:` mapping in the YAML
# frontmatter of .claude/branch-management.local.md (default location: the
# git toplevel, outside a repo: $PWD). Only the block's direct children
# count — nested sub-maps and flow-style (`reviews: {…}`) are ignored.
# Fail-open: only an explicit `false` (case-insensitive, surrounding
# quotes tolerated) disables a review — a missing file, missing block,
# missing key or any other value (including YAML aliases like `no`, `off`,
# `0`) keeps it enabled. Duplicate keys: the last occurrence wins. Inline
# comments after the value are not supported (the value would not match
# `false`). Reviews are a safety net; a broken settings file must not
# silently switch them off.
#
# Exit codes: 0 always (query, not a gate) · 1 usage error
set -euo pipefail

[ "$#" -le 1 ] || { echo "usage: review-settings.sh [settings-file]" >&2; exit 1; }

defaults() { printf 'claude=true\ncodex=true\ncopilot=true\ncoderabbit=true\n'; }

file="${1:-}"
if [ -z "$file" ]; then
  root=$(git rev-parse --show-toplevel 2>/dev/null) || root="$PWD"
  file="$root/.claude/branch-management.local.md"
fi

[ -f "$file" ] || { defaults; exit 0; }
command -v awk >/dev/null 2>&1 || { defaults; exit 0; }   # fail-open, never exit 127

# `|| defaults`: an awk runtime failure (e.g. unreadable file) must keep the
# documented exit-0 / all-true contract instead of tripping set -e.
awk '
  BEGIN { val["claude"] = val["codex"] = val["copilot"] = val["coderabbit"] = "true" }
  { sub(/\r$/, "") }                             # tolerate CRLF explicitly
  NR == 1 { if (substr($0, 1, 3) == "\357\273\277") $0 = substr($0, 4) }  # strip UTF-8 BOM
  NR == 1 && $0 !~ /^---[[:space:]]*$/ { exit }  # no frontmatter at all
  NR == 1 { next }                               # opening ---
  /^---[[:space:]]*$/ { exit }                   # closing --- ends the frontmatter
  /^[^[:space:]]/ {                              # top-level key opens/closes the block
    in_reviews = ($0 ~ /^reviews:[[:space:]]*(#.*)?$/)
    child_indent = 0
    next
  }
  in_reviews && /^[[:space:]]+[^[:space:]]/ && $0 !~ /^[[:space:]]+#/ {
    match($0, /^[[:space:]]+/); ind = RLENGTH
    if (child_indent == 0) child_indent = ind    # first child fixes the depth
    if (ind != child_indent) next                # deeper-nested keys are not toggles
    if ($0 !~ /^[[:space:]]+(claude|codex|copilot|coderabbit):/) next
    key = $0; sub(/^[[:space:]]+/, "", key); sub(/:.*$/, "", key)
    v = $0; sub(/^[^:]*:[[:space:]]*/, "", v); sub(/[[:space:]]+$/, "", v)
    v = tolower(v)                               # accept False/FALSE too
    val[key] = (v == "false" || v == "\"false\"" || v == "\047false\047") ? "false" : "true"
  }
  END {
    printf "claude=%s\ncodex=%s\ncopilot=%s\ncoderabbit=%s\n",
      val["claude"], val["codex"], val["copilot"], val["coderabbit"]
  }
' "$file" || defaults
