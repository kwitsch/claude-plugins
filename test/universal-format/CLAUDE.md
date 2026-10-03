# CLAUDE.md — test/universal-format

## Tests

- **Layout:**
  - One `.bats` file per language/tool (list the directory for the current set), mirroring `test/coding-toolbox/`'s split; `scaffold.bats` covers manifests, hooks.json shape and doc pins.
  - `*.test.mjs` files are `node:test` unit tests.
  - Vehicles: `core.bats`'s guard-clause tests use `.go` + a `gofmt` stub; `css.bats` also covers `.less`.
- **Hermetic policy:**
  - Stub formatters on an isolated `PATH` recording argv; no real network.
  - Prettier-language suites need NO stubs: the bundled prettier needs no network and no `PATH` entry.
  - Assert the prettier-language `printWidth` policy on produced content, not on a recorded argv.
- **Shared helpers** (`test_helper.bash`):
  - `common_setup`, `rg_or_grep`, `make_stub`, `rec_stub`.
  - `_mcp_call`: the single async-safe JSON-RPC driver over the MCP server, held open via a FIFO and polled for the `"id":2` response; it backs `format_file_call`, `pre_tool_use_write_call` and `pre_tool_use_edit_call`.
- **Unit tests** (`*.test.mjs`):
  - `.editorconfig` resolver and registry flag mapping.
  - `prettier.test.mjs`: the in-process prettier contract.
  - `handlers.test.mjs`: `resolveBase`, against the built artifact.
  - `build-artifact.test.mjs`: artifact freshness and the no-`Bun.` invariant.
  - `bundled-plugins.test.mjs`: the three bundled plugins and the four newly routed core languages against the built bundle, plus the tripwire that the `unhandledRejection` guard is armed.
  - `runtime-detect.test.mjs`: spawns the built server under each runtime.
  - Suites importing the built bundle stay stale until `pnpm run build:universal-format-mcp` is rerun (see `src/universal-format-mcp/CLAUDE.md`).
- **Doc pins:** `scaffold.bats` greps `plugins/universal-format/CLAUDE.md` and `src/universal-format-mcp/CLAUDE.md` for pinned phrases; when you rename a heading there, update the pin in the same change.
- **Run:**

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/universal-format/
pnpm run test:unit
pnpm run typecheck
pnpm run lint
```
