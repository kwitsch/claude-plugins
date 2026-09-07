# CLAUDE.md — git-sign-key

Two hooks make `git commit` sign with key file at `~/.claude/sign.key`
(SSH signing) instead of ssh-agent.

## Setup

```bash
ssh-keygen -t ed25519 -f ~/.claude/sign.key -N ""
```

Key created at `~/.claude/sign.key` — must stay unencrypted (passphrase blocks signing).

This plugin predates `.claude/rules/plugin-userconfig.md`'s rule and declares no `userConfig` yet — the legacy exception that rule names.

## Behavior

See `plugins/git-sign-key/hooks/CLAUDE.md` for `hooks/sign-commits.sh` and `hooks/check-sign-key.sh` design detail.

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/git-sign-key/
```

`test/git-sign-key/test.bats` (bats). The suite isolates `$HOME` to a temp dir
to control `~/.claude/sign.key`.
