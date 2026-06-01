#!/usr/bin/env bash
# PreToolUse hook: strip Co-Authored-By trailers and the Claude Code footer
# from git commit messages before the command runs.
#
# Reads the PreToolUse JSON payload on stdin. Fail-open: on any doubt it exits 0
# with no output so the original command runs unchanged (never block/corrupt a
# commit).
set -u

# Fail-open if jq is unavailable.
command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)

# Extract the planned Bash command; bail if absent or unparseable.
command_str=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$command_str" ] || exit 0

# Only act on git commits (literal "git commit" sequence; exotic forms like
# "git -c x=y commit" are out of scope and pass through unchanged).
case "$command_str" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# Clean the command string:
#  1. own-line Co-Authored-By trailers (heredoc form)
#  2. inline -m "Co-Authored-By: ..." arguments (double- and single-quoted)
#  3. the Claude Code footer line, matched by its full signature (the text
#     immediately followed by its "(http..." URL) so that prose merely mentioning
#     the footer name is preserved; and never a line that also contains
#     `git commit` (so the command line itself is never deleted)
cleaned=$(printf '%s' "$command_str" | sed -E \
  -e '/^[[:space:]]*[Cc]o-[Aa]uthored-[Bb]y:/d' \
  -e 's/[[:space:]]*-m[[:space:]]+"[[:space:]]*[Cc]o-[Aa]uthored-[Bb]y:[^"]*"//g' \
  -e "s/[[:space:]]*-m[[:space:]]+'[[:space:]]*[Cc]o-[Aa]uthored-[Bb]y:[^']*'//g" \
  -e '/Generated with \[Claude Code\]\(http/{/git[[:space:]]+commit/!d;}')

# Nothing removed -> stay silent so clean commits are not auto-approved.
[ "$cleaned" = "$command_str" ] && exit 0

# Safety net: if removing the lines produced syntactically broken shell (e.g. a
# trailer embedded mid-string in a multiline -m "..." argument, whose closing
# quote shared the trailer's line), fail open and run the original untouched.
bash -n <<<"$cleaned" 2>/dev/null || exit 0

# Emit the rewritten command, preserving the other tool_input fields.
printf '%s' "$input" | jq --arg cmd "$cleaned" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    updatedInput: (.tool_input + { command: $cmd }),
    additionalContext: "no-co-authored: removed Co-Authored-By / Claude Code footer lines from the commit message before running."
  }
}'
exit 0
