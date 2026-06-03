#!/usr/bin/env bash
# SessionStart hook: warn at session start when file-based signing won't work as
# expected, so the user knows before commits start failing/falling back:
#  - No key at ~/.claude/sign.key -> commits are NOT file-signed; explain setup.
#  - Key present but passphrase-encrypted -> file-based signing bypasses the
#    agent and the hook forces commit.gpgsign=true, so an encrypted key makes
#    every commit fail; warn how to strip the passphrase.
# Silent when an unencrypted key is present (or when we cannot tell).
set -u

KEY_FILE="${HOME:-}/.claude/sign.key"

if [ ! -f "$KEY_FILE" ]; then
  # Static, pre-escaped JSON (no untrusted interpolation) -> no jq/node needed.
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"⚠️ git-sign-key: no signing key found at ~/.claude/sign.key. Git commits will NOT be rewritten for file-based SSH signing — they fall back to your normal git/ssh-agent setup. Surface this to the user and explain how to enable it: 1) ssh-keygen -t ed25519 -C \"your_email\" -f ~/.claude/sign.key -N \"\"   2) chmod 600 ~/.claude/sign.key   3) add ~/.claude/sign.key.pub to your Git host as a SIGNING key (GitHub: Settings -> SSH and GPG keys -> New SSH key -> Key type: Signing Key). See the git-sign-key plugin README for full setup and signature verification."}}'
  exit 0
fi

# Key exists. If it cannot be used for non-interactive file-based signing — it is
# passphrase-encrypted (ssh-keygen reports "passphrase"/"decrypt") or has unsafe
# permissions (ssh-keygen refuses with "bad permissions"/"too open" before it
# even reaches the key) — every commit will FAIL, because file-based signing
# bypasses the agent and the hook forces commit.gpgsign=true. Warn early. We only
# warn on these positive signals, so a dummy/non-key file ("invalid format")
# stays silent. </dev/null guarantees ssh-keygen never blocks on a prompt.
if command -v ssh-keygen >/dev/null 2>&1; then
  err=$(ssh-keygen -y -f "$KEY_FILE" -P '' </dev/null 2>&1 >/dev/null)
  case "$err" in
    *passphrase*|*decrypt*|*ermission*|*"too open"*)
      printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"⚠️ git-sign-key: ~/.claude/sign.key cannot be used for non-interactive signing — it is either passphrase-encrypted or has unsafe file permissions. File-based SSH signing bypasses the ssh-agent, so every git commit will FAIL (the hook forces commit.gpgsign=true). Make sure the key is unencrypted (ssh-keygen -p -f ~/.claude/sign.key -N \"\", understand the security tradeoff) and locked down (chmod 600 ~/.claude/sign.key). See the git-sign-key plugin README."}}'
      exit 0
      ;;
  esac
fi

exit 0
