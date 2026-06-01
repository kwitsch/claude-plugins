#!/usr/bin/env bash
# SessionStart hook: warn at session start when no signing key is present at
# ~/.claude/sign.key, so the user knows commits will NOT be file-signed and how
# to enable it. Silent when the key exists.
set -u

KEY_FILE="${HOME:-}/.claude/sign.key"

[ -f "$KEY_FILE" ] && exit 0

# Static, pre-escaped JSON (no untrusted interpolation) -> no jq/node needed.
printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"⚠️ git-sign-key: no signing key found at ~/.claude/sign.key. Git commits will NOT be rewritten for file-based SSH signing — they fall back to your normal git/ssh-agent setup. Surface this to the user and explain how to enable it: 1) ssh-keygen -t ed25519 -C \"your_email\" -f ~/.claude/sign.key -N \"\"   2) chmod 600 ~/.claude/sign.key   3) add ~/.claude/sign.key.pub to your Git host as a SIGNING key (GitHub: Settings -> SSH and GPG keys -> New SSH key -> Key type: Signing Key). See the git-sign-key plugin README for full setup and signature verification."}}'
exit 0
