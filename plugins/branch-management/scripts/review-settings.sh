#!/usr/bin/env bash
# review-settings.sh [settings-file] — print the new-pr review toggles, one
# `<tool>=true|false` line each for claude, codex, copilot and coderabbit.
#
# Two layered sources, both optional: the top-level block-style `reviews:`
# mapping in the YAML frontmatter of the user-level
# ~/.claude/branch-management.local.md, then of the project-level
# <git-toplevel>/.claude/branch-management.local.md (outside a repo: $PWD;
# the argument overrides the project path). Later layers win per key, but
# only explicit values assign: `true`/`false` (case-insensitive,
# surrounding quotes tolerated) — anything else is neutral and leaves the
# lower layer untouched. Only a block's direct children count — nested
# sub-maps and flow-style (`reviews: {…}`) are ignored. Duplicate keys:
# the last occurrence wins. Inline comments after the value are not
# supported (the value is neutral then). Fail-open: a review is only
# disabled by an explicit `false` in some layer — a missing or unreadable
# file, missing block, missing key or invalid value never disables, and a
# broken layer is skipped without affecting the other. Reviews are a
# safety net; a broken settings file must not silently switch them off.
#
# Exit codes: 0 always (query, not a gate) · 1 usage error
set -euo pipefail

[ "$#" -le 1 ] || { echo "usage: review-settings.sh [settings-file]" >&2; exit 1; }

rel='.claude/branch-management.local.md'

project="${1:-}"
if [ -z "$project" ]; then
  root=$(git rev-parse --show-toplevel 2>/dev/null) || root="$PWD"
  project="$root/$rel"
fi

claude=true codex=true copilot=true coderabbit=true

# Emits one `key=true|false` line per explicit assignment in one file;
# neutral/invalid values emit nothing. LC_ALL=C keeps substr() byte-based
# so the UTF-8 BOM strip also works under UTF-8 locales.
parse_file() {
  LC_ALL=C awk '
    NR == 1 { if (substr($0, 1, 3) == "\357\273\277") $0 = substr($0, 4) }  # strip UTF-8 BOM
    { sub(/\r$/, "") }                             # tolerate CRLF explicitly
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
      v = tolower(v)                               # accept False/TRUE etc.
      gsub(/^["\047]|["\047]$/, "", v)             # strip surrounding quotes
      if (v == "true" || v == "false") print key "=" v
    }
  ' "$1" 2>/dev/null || true                       # a broken layer must not kill the query
}

for f in "${HOME:+$HOME/$rel}" "$project"; do
  [ -n "$f" ] && [ -f "$f" ] && [ -r "$f" ] || continue
  while IFS='=' read -r k v; do
    case "$v" in true|false) ;; *) continue ;; esac
    case "$k" in
      claude)     claude=$v ;;
      codex)      codex=$v ;;
      copilot)    copilot=$v ;;
      coderabbit) coderabbit=$v ;;
    esac
  done < <(parse_file "$f")
done

printf 'claude=%s\ncodex=%s\ncopilot=%s\ncoderabbit=%s\n' \
  "$claude" "$codex" "$copilot" "$coderabbit"
