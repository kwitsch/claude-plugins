#!/usr/bin/env bash
# Resolve setup-rules' verbatim $ARGUMENTS text into golden_rules/tools
# yes/no/unset answers. Pure string processing -- no external CLI, no file
# writes, never touches the filesystem outside its own stdout/stderr.
#
# Usage: parse-args.sh <verbatim-argument-text>
# Exit: 0 ok - 2 no verb matched - 3 ambiguous verb - 4 ambiguous target -
#       5 destructive verb named with no target named at all
set -uo pipefail

raw="${1:-}"

usage_msg() {
  printf 'Couldn'"'"'t parse "%s" -- expected a verb (install/update/remove) and, for remove, an explicit target (rules/tools/both). Examples: "install", "update tools rule", "remove rules", "remove both".\n' "$raw" >&2
}

in_list() {
  local needle="$1"; shift
  local w
  for w in "$@"; do [ "$needle" = "$w" ] && return 0; done
  return 1
}

# noglob during the split: this is a whitespace split on lowercased free
# text, never a filename expansion, even if the text happens to contain a
# glob metacharacter.
set -f
words=($(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]'))
set +f

no_match=false
yes_match=false
tools_named=false
golden_named=false
both_named=false
bare_rule_present=false
for w in "${words[@]:-}"; do
  in_list "$w" remove uninstall delete disable no && no_match=true
  in_list "$w" install add enable update refresh yes && yes_match=true
  in_list "$w" tool tools tool-routing routing && tools_named=true
  in_list "$w" golden golden-rules && golden_named=true
  in_list "$w" rule rules && bare_rule_present=true
  in_list "$w" both all everything && both_named=true
done

if [ "$no_match" = true ] && [ "$yes_match" = true ]; then
  usage_msg; exit 3
elif [ "$no_match" = true ]; then
  answer=no
elif [ "$yes_match" = true ]; then
  answer=yes
else
  usage_msg; exit 2
fi

# A bare "rule"/"rules" is generic filler in a "tools rule" phrase, not a
# second, competing target -- it only names golden-rules when no
# tool-family word is present anywhere in the input.
if [ "$bare_rule_present" = true ] && [ "$tools_named" = false ]; then
  golden_named=true
fi

if [ "$tools_named" = true ] && [ "$golden_named" = true ]; then
  usage_msg; exit 4
fi
if [ "$both_named" = true ] && { [ "$tools_named" = true ] || [ "$golden_named" = true ]; }; then
  usage_msg; exit 4
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
  usage_msg; exit 5
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
