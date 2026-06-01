# git-sign-key

Signs your git commits with a key **file** at `~/.claude/sign.key` via SSH
signing, instead of relying on the `ssh-agent`.

## Install

```
/plugin install git-sign-key@claude-plugins
```

## What it does

- A **PreToolUse** hook on the Bash tool watches for `git commit` commands. When
  `~/.claude/sign.key` exists, it rewrites the command in place to:

  ```
  git -c gpg.format=ssh -c user.signingkey='/home/you/.claude/sign.key' -c commit.gpgsign=true commit …
  ```

  (the hook injects the absolute, `$HOME`-expanded path, not a literal `~`) so
  the commit is SSH-signed by reading the private key directly from the file —
  the `ssh-agent` is never consulted.
- When `~/.claude/sign.key` does **not** exist, commands are left **completely
  untouched** (no signing config is injected).
- A **SessionStart** hook warns you at the start of a session when the key file
  is missing, with the setup steps below.

The **rewrite** is best-effort and never blocks a commit: if the command can't
be parsed or the rewrite would break shell syntax, the original command runs
unchanged. Note, though, that the rewrite injects `commit.gpgsign=true`, so once
the key is present the **commit itself** will fail (non-zero, no commit created)
if signing can't complete — e.g. the key is passphrase-protected, unreadable, or
your git/ssh-keygen is too old for SSH signing. Keep the key unencrypted and
readable (see below).

## Setting up the signing key

The plugin expects an **unencrypted SSH private key** at `~/.claude/sign.key`.
"Unencrypted" matters: file-based signing bypasses the agent, so a passphrase
would block every commit with an interactive prompt.

### Option A — create a dedicated signing key (recommended)

```bash
# Generate a new ed25519 key with no passphrase, written to ~/.claude/sign.key
ssh-keygen -t ed25519 -C "your_email@example.com" -f ~/.claude/sign.key -N ""

# Lock down the private key
chmod 600 ~/.claude/sign.key
```

This produces two files:

- `~/.claude/sign.key` — the private key the plugin signs with.
- `~/.claude/sign.key.pub` — the public key you register with your Git host.

### Option B — reuse an existing key

Copy an existing **unencrypted** private key into place:

```bash
cp ~/.ssh/id_ed25519     ~/.claude/sign.key
cp ~/.ssh/id_ed25519.pub ~/.claude/sign.key.pub   # optional but recommended
chmod 600 ~/.claude/sign.key
```

If the source key has a passphrase, strip it for this purpose with
`ssh-keygen -p -f ~/.claude/sign.key -N ""` (understand the security tradeoff
first).

### Register the public key for the "Verified" badge

Add `~/.claude/sign.key.pub` to your Git host **as a signing key** (not just an
auth key):

- **GitHub:** Settings → SSH and GPG keys → New SSH key → **Key type: Signing
  Key**.
- **GitLab:** Preferences → SSH Keys → add the key with **Usage type: Signing**.

### Verifying signatures locally (optional)

To let `git log --show-signature` verify your own commits, add the key to an
allowed-signers file:

```bash
git config --global gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers
printf '%s %s\n' "your_email@example.com" "$(cat ~/.claude/sign.key.pub)" \
  >> ~/.config/git/allowed_signers
```

## Security notes

- `~/.claude/sign.key` is an unencrypted private key — protect it with `chmod
  600` and never commit it to a repository.
- Anyone with read access to the file can sign commits as you. Use a dedicated
  key you can revoke independently from your auth keys.

## Notes & limitations

- The hook forces `commit.gpgsign=true` for the rewritten command, so every
  `git commit` it touches is signed while the key is present.
- It rewrites the first `git commit` token of a command; exotic invocations
  (e.g. `git -C path commit`, or the literal `git commit` only appearing inside
  a quoted message) may not be rewritten and fall back to your normal git setup.
- If another Bash `PreToolUse` hook also rewrites the command (Claude Code keeps
  the last writer's `updatedInput`), the two can conflict — install only one
  command-rewriting hook per tool.
