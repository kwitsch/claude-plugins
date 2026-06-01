#!/usr/bin/env bash
# PreToolUse hook: strip Co-Authored-By trailers and the Claude Code footer
# from git commit messages before the command runs.
#
# JSON read/emit uses jq if present, else node (ships with npm). If neither is
# present the message cannot be cleaned, so the commit is blocked (deny) and the
# rule is handed to Claude. Other doubts fail open (exit 0, no output).
set -u

input=$(cat)

# Pick a JSON tool: jq preferred, else node, else neither -> deny.
if command -v jq >/dev/null 2>&1; then
  JSON_TOOL=jq
elif command -v node >/dev/null 2>&1; then
  JSON_TOOL=node
else
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"no-co-authored: neither jq nor node is available to clean the commit message. Recreate the commit WITHOUT any Co-Authored-By trailer and without the \"Generated with [Claude Code]\" footer."}}'
  exit 0
fi

# Read tool_input.command.
if [ "$JSON_TOOL" = jq ]; then
  command_str=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
else
  command_str=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);process.stdout.write((o.tool_input&&o.tool_input.command)||"")}catch(e){}})' 2>/dev/null) || exit 0
fi
[ -n "$command_str" ] || exit 0

# Only act on git commits.
case "$command_str" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# Clean: own-line Co-Authored-By, inline -m co-author args, footer (full
# signature only), never the git commit line itself.
cleaned=$(printf '%s' "$command_str" | sed -E \
  -e '/^[[:space:]]*[Cc]o-[Aa]uthored-[Bb]y:/d' \
  -e 's/[[:space:]]*-m[[:space:]]+"[[:space:]]*[Cc]o-[Aa]uthored-[Bb]y:[^"]*"//g' \
  -e "s/[[:space:]]*-m[[:space:]]+'[[:space:]]*[Cc]o-[Aa]uthored-[Bb]y:[^']*'//g" \
  -e '/Generated with \[Claude Code\]\(http/{/git[[:space:]]+commit/!d;}')

# Nothing removed -> stay silent (do not auto-approve clean commits).
[ "$cleaned" = "$command_str" ] && exit 0

# Safety net: if cleaning produced broken shell, fail open.
bash -n <<<"$cleaned" 2>/dev/null || exit 0

# Emit the rewrite decision, preserving the other tool_input fields.
NOTE="no-co-authored: removed Co-Authored-By / Claude Code footer lines from the commit message before running."
if [ "$JSON_TOOL" = jq ]; then
  printf '%s' "$input" | jq --arg cmd "$cleaned" --arg note "$NOTE" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: (.tool_input + { command: $cmd }),
      additionalContext: $note
    }
  }'
else
  printf '%s' "$input" | CLEANED="$cleaned" NOTE="$NOTE" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const ti=Object.assign({},o.tool_input,{command:process.env.CLEANED});process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:ti,additionalContext:process.env.NOTE}}))})'
fi
exit 0
