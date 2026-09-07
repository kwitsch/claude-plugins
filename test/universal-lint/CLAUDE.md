# CLAUDE.md — test/universal-lint

## Tests

`test/universal-lint/` — split into one `.bats` file per language/tool
(`scaffold.bats`, `core.bats`, `go.bats`, `checkstyle.bats`,
`truncation.bats`, `npx-fallback.bats`, `rtk.bats`, `yaml.bats`,
`markdown.bats`, `stylelint.bats`, `tsc.bats`, `php.bats`, `rust.bats`,
`debounce.bats`), mirroring
`test/coding-toolbox/`'s split. `test_helper.bash` holds what's shared
across files (`common_setup`, `rg_or_grep`, `make_stub`, `rec_stub`,
`lint_file_call`); `rtk_stub` stays local to `rtk.bats`, the only file that
uses it. Hermetic: stub linters on an isolated PATH recording argv, piping
a PostToolUse hook-JSON payload into a fresh `lint-file.mjs` invocation per
test. Plus `test/universal-lint/registry.test.mjs` (`node:test` unit tests
for `classifyExit`, `classifyCheckstyleOutput`, `resolveCheckstyleConfig`,
`buildArgv`, `truncate`). Run:

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/universal-lint/
pnpm run test:unit
pnpm run typecheck
```
