# CLAUDE.md — dprint

Skill-only plugin. One model-invocable skill, `init-dprint`
(`skills/init-dprint/SKILL.md`), plus its zero-dep detection script
`skills/init-dprint/scripts/check-dprint.mjs` (contract: `scripts/check-dprint.reference.md`).
No hooks, MCP server, `bin/`, or `userConfig`.

## Minimum version

`MIN_VERSION` is defined only in `skills/init-dprint/scripts/check-dprint.mjs`. Changing
it is a one-line edit there plus the "Minimum dprint version" line in
`README.md`; the equal-version bats test reads the value from the script.

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/dprint/
```

`test/dprint/test.bats` holds manifest/registration/SKILL.md static checks;
`test/dprint/check-dprint.bats` holds the script contract tests (stub `dprint`
on an isolated `PATH`, `HOME` redirected). The version-pin test is a **rolling
pin**: it asserts the exact `plugin.json` version. Any future version bump MUST
update that assertion in the same commit, or CI turns red.
