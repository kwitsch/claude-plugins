# CLAUDE.md — test/universal-lint

## Tests

`test/universal-lint/` — split into one `.bats` file per language/tool,
mirroring `test/coding-toolbox/`'s split. `test_helper.bash` holds what's shared
across files; a helper used by one file stays local to it. Hermetic: stub
linters on an isolated PATH recording argv, piping a PostToolUse hook-JSON
payload into a fresh `lint-file.mjs` invocation per test. Plus
`test/universal-lint/registry.test.mjs` (`node:test` unit tests). Run:

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/universal-lint/
pnpm run test:unit
pnpm run typecheck
```
