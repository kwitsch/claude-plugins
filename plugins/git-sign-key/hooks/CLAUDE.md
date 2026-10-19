# CLAUDE.md — git-sign-key/hooks

Wiring lives in `register.ts`, logic in `sign.mjs`. Only rationale and pitfalls are kept here.

## `tool.call` on `Bash` (rewrite)

- When `$HOME/.claude/sign.key` is a regular file (`$.fs.stat` kind `file`, links followed — the old `[ -f ]`), `rewriteCommand` injects the signing flags right after the `git` token of every commit invocation and the hook calls `next({ ...e, command })`. Other tool arguments (`description`, ...) ride along unchanged.
- Pin `gpg.ssh.program=ssh-keygen`:
  - A custom global `gpg.ssh.program` (1Password `op-ssh-sign`, etc.) would otherwise receive the on-disk key path, which it cannot read.
  - With `commit.gpgsign=true` forced, that makes the commit fail.
- Keep the scanner quote-aware:
  - It rewrites every `git` at an unquoted command position, so `a && b` and `$(…)`/backticks are signed and quoted text is left untouched.
  - A separator inside a quoted arg (e.g. `-m "fix; git commit later"`) must not count as a command position — that would inject flags into the literal and still pass `bash -n`.
- `commitInvocation` skips global options (`-C <path>`, `-c k=v`, `--long`) to reach the subcommand and requires a right boundary after `commit`, so `commit-tree`/`committed` never match.
- A leading `rtk ` word at a command position is skipped as a transparent wrapper (`rtk git commit` → signed): linux-token-efficiency's `tool.call` rtk rewrite may run before this hook in the mods chain (cross-plugin order is not documented).
- Idempotency via the marker `user.signingkey='<key>'`; an already-wired command is skipped.
  - The marker is the signing-key flag, not `gpg.ssh.program`: matching the latter would skip a real commit where the user pinned ssh-keygen themselves.
- Build the flag string by concatenation (template literal), so `&`/`\` in `$HOME` stay literal; single-quote the key path so spaces survive.
- Safety net: a rewrite is dropped unless `bash -n` (`$.process.run`, stdin = the rewritten command) exits 0. Only rewritten commands spawn it; any other Bash call spawns nothing.
- After `next`, the rewrite note is appended to the result's `context` (the old `additionalContext`); a `{ deny }` result passes through untouched.
- Ported from `sign-commits.sh` (removed in 1.2.0); `test/git-sign-key/sign.test.mjs` carries every case of the old bats suite.

## `tool.check` on `Bash` (auto-allow)

- The old hook answered `permissionDecision: allow` for every command it rewrote. The module keeps that: `tool.call` records the call's `tool_use_id` while it runs, and `tool.check` turns core's `ask` for exactly that id into `allow`.
- Only the mode's default `ask` is upgraded (no `rule`, `hook` or `setting` on core's verdict): an `ask` settings rule, a settings PreToolUse hook's `ask` or an option's own check (`permissions.blockReadsOutsideWorkingDirectories`) still prompts, as the old `permissionDecision: allow` did not override them either. Only `ask` is upgraded. A `deny` stands, and an existing `allow` is returned as is — rewording it (even only `reason`) makes `cc-plugin-sec-default` bypass the hook (live, 2.1.302).

## `session.start` (warning)

- Fires once per process (never on `/clear`, unlike the old matcher-less SessionStart hook, which re-injected after clear/compact); skipped when the transcript already holds user turns (`$.session.turns() > 0`: resume, mid-session reload or enable), so the warning is never appended twice.
- Missing key → appends `MISSING_KEY_WARNING` as a user meta row (`$.session.append`), the old `additionalContext`.
- Key present → probes `ssh-keygen -y -f <key> -P ''` (`$.process.run`, empty stdin); warns (`UNUSABLE_KEY_WARNING`) only on positive stderr signals (`passphrase`, `decrypt`, `ermission`, `too open`), so a dummy/invalid key file stays silent. An `ssh-keygen` that cannot start is "cannot tell" (silent).

## Fail-open stance

- Missing key, non-commit or non-string command, any `$` call that throws, or a rewrite that fails `bash -n` all call `next(e)` unchanged — the hook never blocks a commit. No `.catch` deny is registered (validate lists the hooks as "gating hook without .catch", intended).
- Once the key is present, `commit.gpgsign=true` means git itself fails the commit if signing cannot complete (see the README).
