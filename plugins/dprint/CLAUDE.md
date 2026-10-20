# CLAUDE.md — dprint

One model-invocable skill, `init-dprint` (`skills/init-dprint/SKILL.md`), plus its
zero-dep detection script `skills/init-dprint/check-dprint.mjs` (contract:
`check-dprint.reference.md`), and a mods hooks module whose `session.start` hook
toasts when a project has a dprint config but dprint is not installed. No MCP
server, no `bin/`; one fail-open `userConfig` toggle (`warn_missing_dprint`).

## Layout

Mods layout as `plugins/inline-headroom/CLAUDE.md` describes:

- `hooks/hooks.json` — exactly `{"modules": ["./register.ts"]}`.
- `hooks/register.ts` — the one `session.start` hook and every `$` use.
- `hooks/detect.mjs` — pure, zero-dep, JSDoc-typed logic (config candidates, dprint candidates, toggle parser, toast text); never references `$`. `100755` per `.claude/rules/hooks-executable.md`.
- `tests/dprint.test.ts` — hook wiring for `claude plugin test` (local only).
- `.claude-plugin/types/` — engine-written, gitignored.

Design detail and pitfalls: `plugins/dprint/hooks/CLAUDE.md`.

## Minimum version

`MIN_VERSION` is defined only in `skills/init-dprint/check-dprint.mjs`. Changing
it is a one-line edit there plus the "Minimum dprint version" line in
`README.md`; the equal-version bats test reads the value from the script.

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/dprint/
# CI: detect.mjs logic (test/dprint/detect.test.mjs)
pnpm run test:unit
# local only
claude plugin validate plugins/dprint && claude plugin test plugins/dprint
```

`test/dprint/test.bats` holds manifest/registration/SKILL.md/mods-wiring static
checks (runs `claude plugin validate`/`test` when `claude` is on PATH);
`test/dprint/check-dprint.bats` holds the script contract tests (stub `dprint`
on an isolated `PATH`, `HOME` redirected). The version-pin test (`plugin.json is
valid, pins version 0.2.0, and has required fields`) is a **rolling pin**: any
future version bump MUST update its name and value in the same commit, or CI
turns red.
