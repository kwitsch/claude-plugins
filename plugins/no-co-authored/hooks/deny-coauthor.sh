#!/usr/bin/env bash
# PreToolUse hook: scan git commit commands for a Co-Authored-By trailer or the
# Claude Code footer and DENY the commit when either is present. Scan only — it
# never rewrites the command. On a finding it hands the rule back to Claude so
# the commit gets recreated without those lines.
#
# Pure shell `case` matching on the raw hook payload: no jq/node dependency.
# `Co-Authored-By:` and `Generated with [Claude Code](http` are plain ASCII that
# JSON never escapes, so they survive verbatim in the payload. Anything that is
# not a git commit, or a clean commit, falls open (exit 0, no output).
set -u

input=$(cat)

# Only git commits are in scope.
case "$input" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# Look for a co-author trailer and the full footer signature. The trailing
# `](http` on the footer keeps prose that merely mentions "[Claude Code]" from
# tripping the rule.
# The reason text is hand-assembled into JSON below without jq, so it must stay
# JSON-safe: plain ASCII, no double quotes, backslashes, or newlines.
found=""
case "$input" in
  *[Cc]o-[Aa]uthored-[Bb]y:*) found="a Co-Authored-By trailer" ;;
esac
case "$input" in
  *"Generated with [Claude Code](http"*)
    if [ -n "$found" ]; then
      found="$found and the Claude Code footer"
    else
      found="the Claude Code footer"
    fi
    ;;
esac

# Clean commit -> stay silent (do not auto-approve).
[ -n "$found" ] || exit 0

reason="no-co-authored: this git commit message contains $found. Recreate the commit WITHOUT any Co-Authored-By trailer and without the Generated with [Claude Code] footer."

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' "$reason"
exit 0
