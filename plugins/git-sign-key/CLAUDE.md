# CLAUDE.md — git-sign-key

One mods hooks module makes `git commit` sign with key file at `~/.claude/sign.key`
(SSH signing) instead of ssh-agent. No command hooks, no processes per Bash call.

## Setup

```bash
ssh-keygen -t ed25519 -f ~/.claude/sign.key -N ""
```

Key created at `~/.claude/sign.key` — must stay unencrypted (passphrase blocks signing).

This plugin predates `.claude/rules/plugin-userconfig.md`'s rule and declares no `userConfig` yet — the legacy exception that rule names.

## Layout

Mods layout as `plugins/inline-headroom/CLAUDE.md` describes:

- `hooks/hooks.json` — exactly `{"modules": ["./register.ts"]}`.
- `hooks/register.ts` — every hook and every `$` use (`tool.call` / `tool.check` on `Bash`, `session.start`).
- `hooks/sign.mjs` — pure, zero-dep, JSDoc-typed logic (the rewrite scanner, key path, warning texts); never references `$`. `100755` per `.claude/rules/hooks-executable.md`.
- `tests/git-sign-key.test.ts` — hook wiring for `claude plugin test` (local only).
- `.claude-plugin/types/` — engine-written, gitignored.

Design detail and pitfalls: `plugins/git-sign-key/hooks/CLAUDE.md`.

## Tests

```bash
# CI: the rewrite + SessionStart logic (test/git-sign-key/sign.test.mjs)
pnpm run test:unit
# CI: manifest and wiring only (runs claude plugin validate/test when claude is on PATH)
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/git-sign-key/
# local only
claude plugin validate plugins/git-sign-key && claude plugin test plugins/git-sign-key
```

The bats version-pin test (`plugin.json is valid JSON with name and version 1.2.0`) is a rolling pin: every version bump rewrites its name and expected value in the same commit.
