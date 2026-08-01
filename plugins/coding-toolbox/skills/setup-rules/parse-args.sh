#!/usr/bin/env bash
# Resolve setup-rules' verbatim argument text -- read from a file, never a
# raw shell argument or a heredoc (see parse-args.reference.md for why) --
# into golden_rules/tools yes/no/unset answers. Pure string processing --
# no external CLI, no file writes, touches the filesystem only to read the
# one input file the caller wrote.
#
# Usage: parse-args.sh <path-to-file-containing-verbatim-argument-text>
# Exit: 0 ok - 2 no verb matched - 3 ambiguous verb - 4 ambiguous target -
#       5 destructive verb named with no target named at all -
#       6 usage (missing/unreadable input file)
set -uo pipefail

args_file="${1:-}"
if [ -z "$args_file" ] || [ ! -r "$args_file" ]; then
  echo "usage: parse-args.sh <path-to-file-containing-verbatim-argument-text> -- missing or unreadable file" >&2
  exit 6
fi
raw="$(cat "$args_file")"

usage_msg() {
  printf 'Couldn'"'"'t parse "%s" -- expected a verb (install/update/remove) and, for remove, an explicit target (rules/tools/both). Examples: "install", "update tools rule", "remove rules", "remove both".\n' "$raw" >&2
}
die() { usage_msg; exit "$1"; }

# noglob during the split: this is a whitespace split on lowercased free
# text, never a filename expansion, even if the text happens to contain a
# glob metacharacter. `tr 'A-Z' 'a-z'` uses explicit byte ranges, not the
# locale-sensitive [:upper:]/[:lower:] POSIX classes (which fold ASCII `I`
# to dotless-i under e.g. a Turkish/Azerbaijani locale) -- this never
# mis-folds regardless of the caller's locale, and needs no bash version
# newer than POSIX sh.
set -f
words=($(printf '%s' "$raw" | tr 'A-Z' 'a-z'))
set +f

no_match=false
yes_match=false
tools_named=false
golden_named=false
both_named=false
bare_rule_present=false
for w in "${words[@]:-}"; do
  case "$w" in
    remove|uninstall|delete|disable|no) no_match=true ;;
    install|add|enable|update|refresh|yes) yes_match=true ;;
    tool|tools|tool-routing|routing) tools_named=true ;;
    golden|golden-rules) golden_named=true ;;
    rule|rules) bare_rule_present=true ;;
    both|all|everything) both_named=true ;;
  esac
done

if [ "$no_match" = true ] && [ "$yes_match" = true ]; then
  die 3
elif [ "$no_match" = true ]; then
  answer=no
elif [ "$yes_match" = true ]; then
  answer=yes
else
  die 2
fi

# A bare "rule"/"rules" is generic filler in a "tools rule" phrase, not a
# second, competing target -- it only names golden-rules when no
# tool-family word is present anywhere in the input.
if [ "$bare_rule_present" = true ] && [ "$tools_named" = false ]; then
  golden_named=true
fi

if [ "$tools_named" = true ] && [ "$golden_named" = true ]; then
  die 4
fi
if [ "$both_named" = true ] && { [ "$tools_named" = true ] || [ "$golden_named" = true ]; }; then
  die 4
fi

if [ "$both_named" = true ]; then
  target=both
elif [ "$tools_named" = true ]; then
  target=tools
elif [ "$golden_named" = true ]; then
  target=rules
elif [ "$answer" = yes ]; then
  target=both
else
  die 5
fi

golden_rules=unset
tools=unset
case "$target" in
  rules) golden_rules="$answer" ;;
  tools) tools="$answer" ;;
  both) golden_rules="$answer"; tools="$answer" ;;
esac

printf 'golden_rules: %s\ntools: %s\n' "$golden_rules" "$tools"
exit 0
