#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash): when ~/.claude/sign.key exists, rewrite
# `git commit` commands so signing uses that key FILE via SSH signing, instead
# of the ssh-agent. When the key file is absent the command is left untouched.
#
# Best-effort by design: a parse/rewrite miss must never block a commit, so
# every uncertain path fails open (exit 0, no output). JSON is read/emitted with
# jq if present, else node (ships with npm); without either we fail open too.
set -u

input=$(cat)

KEY_FILE="${HOME:-}/.claude/sign.key"

# Pick a JSON tool: jq preferred, else node, else fail open (no rewrite).
if command -v jq >/dev/null 2>&1; then
  JSON_TOOL=jq
elif command -v node >/dev/null 2>&1; then
  JSON_TOOL=node
else
  exit 0
fi

# Read tool_input.command (only a string command is actionable).
if [ "$JSON_TOOL" = jq ]; then
  command_str=$(printf '%s' "$input" | jq -r '.tool_input.command | strings' 2>/dev/null) || exit 0
else
  command_str=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s),c=o.tool_input&&o.tool_input.command;process.stdout.write(typeof c==="string"?c:"")}catch(e){}})' 2>/dev/null) || exit 0
fi
[ -n "$command_str" ] || exit 0

# Requirement: rewrite ONLY when the signing key file is present.
[ -f "$KEY_FILE" ] || exit 0

# Inject SSH file-based signing config right before the `commit` subcommand. The
# path is single-quoted so spaces in $HOME survive shell word-splitting. The
# command is rebuilt by concatenation (not ${var/.../...}) so that & or \ in
# $HOME stay literal in the injected path.
flags="-c gpg.format=ssh -c user.signingkey='$KEY_FILE' -c commit.gpgsign=true"

# Match `git commit` only as the subcommand — followed by a space (options) or
# the end of the string — so `git commit-tree`, `git committed`, etc. and the
# word "commit" inside a message are left alone. Only the first occurrence is
# rewritten.
case "$command_str" in
  *"git commit "*)
    head="${command_str%%git commit *}"   # text before the first "git commit "
    rest="${command_str#*git commit }"    # text after the first "git commit "
    cleaned="${head}git ${flags} commit ${rest}"
    ;;
  *"git commit")
    cleaned="${command_str%git commit}git ${flags} commit"
    ;;
  *)
    exit 0
    ;;
esac

# Nothing changed -> stay silent (do not auto-approve unrelated commits).
[ "$cleaned" = "$command_str" ] && exit 0

# Safety net: if the rewrite produced broken shell, fail open.
bash -n <<<"$cleaned" 2>/dev/null || exit 0

NOTE="git-sign-key: routed commit signing through $KEY_FILE (file-based SSH signing, ssh-agent bypassed)."
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
