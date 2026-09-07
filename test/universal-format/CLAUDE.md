# CLAUDE.md — test/universal-format

## Tests

`test/universal-format/` — split into one `.bats` file per language/tool
(`scaffold.bats`, `core.bats`, `go.bats`, `kotlin.bats`, `java.bats`,
`python.bats`, `rust.bats`, `jsts.bats`, `json.bats`, `yaml.bats`, `markdown.bats`,
`css.bats`, `php.bats`, `shell.bats`, `html.bats`, `vue.bats`, `graphql.bats`),
mirroring `test/coding-toolbox/`'s split. `test_helper.bash`
holds what's shared across files (`common_setup`, `rg_or_grep`, `make_stub`,
`rec_stub`, and `_mcp_call` — the single async-safe JSON-RPC driver over the MCP
server, held open via a FIFO and polled for the `"id":2` response, wrapping
`format_file_call`/`pre_tool_use_write_call`/`pre_tool_use_edit_call`). Hermetic:
stub formatters on an isolated `PATH` recording argv, no real network — the
prettier-language suites need **no stubs at all**, since the bundled prettier needs
no network and no PATH entry. The prettier-language `printWidth` policy is asserted
on produced content rather than on a recorded argv. `core.bats`'s guard-clause vehicle
is `.go` + a `gofmt` stub (it used `.sh` + a CLI shell-formatter stub until `.sh` became
a `format_pre` language), and `css.bats` also covers `.less`. Plus
`test/universal-format/*.test.mjs` (`node:test` unit tests for the `.editorconfig`
resolver, registry flag mapping, the in-process prettier contract in
`prettier.test.mjs`, artifact freshness in `build-artifact.test.mjs`, and
`bundled-plugins.test.mjs` — the three bundled plugins and the four newly routed core
languages against the built bundle, plus the structural tripwire that the
`unhandledRejection` guard is armed). Run:

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/universal-format/
pnpm run test:unit
pnpm run typecheck
pnpm run lint
```
