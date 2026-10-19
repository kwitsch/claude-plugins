# CLAUDE.md — test/universal-format

## Tests

- **Layout:**
  - One `.bats` file per language/tool (list the directory for the current set), mirroring `test/coding-toolbox/`'s split; `scaffold.bats` covers manifests, hooks.json shape, the launcher (stub `node`/`bun` on an isolated `PATH` pin its `NODE_COMPILE_CACHE` export) and doc pins.
  - `*.test.mjs` files are `node:test` unit tests.
  - Vehicles: `core.bats`'s guard-clause and stdin-contract tests use `.go` + a `gofmt` stub; `css.bats` also covers `.less`.
- **Hermetic policy:**
  - Stub formatters on an isolated `PATH` (`rec_stub`: records argv, drains stdin, prints a marker line as its "formatted" output); no real network.
  - Prettier-language suites need NO stubs: the bundled prettier needs no network and no `PATH` entry.
  - Assert the prettier-language `printWidth` policy on produced content, not on a recorded argv.
- **Shared helpers** (`test_helper.bash`):
  - `common_setup`, `rg_or_grep`, `make_stub`, `rec_stub`.
  - `_mcp_call`: the single async-safe JSON-RPC driver over the MCP server, held open via a FIFO and polled for the `"id":2` response; it backs `pre_tool_use_write_call` and `pre_tool_use_edit_call` (format_pre is the server's only tool).
- **Unit tests** (`*.test.mjs`):
  - `.editorconfig` resolver and registry flag mapping.
  - `prettier.test.mjs`: the in-process prettier contract, `shrinkSwap` (the changed-lines Edit swap) and the landed-write config/ignore cache refresh.
  - `cli-stdin.test.mjs`: the CLI languages through the built artifact with a `goimports`/`gofmt` stub pair on `PATH` (stdin in, stdout out, `-srcdir`, the Edit swap, exit-code and empty-stdout fail-open). Its own file because `onPath()` caches the PATH probe per tool name for the process lifetime.
  - `handlers.test.mjs`: `resolveBase`, against the built artifact.
  - `build-artifact.test.mjs`: artifact freshness, the no-`Bun.` invariant, and the behavioral check that importing the artifact evaluates none of the three bundled plugins (no `.wasm` read, no leaked globals; a child process, with a java+shell positive control).
  - `bundled-plugins.test.mjs`: the three bundled plugins (incl. prettier-plugin-sh's `experimentalWasm` path through `main.wasm`) and the four newly routed core languages against the built bundle, the per-language lazy-loading table (`bundledPluginsFor`, Markdown's fenced-block trio), plus the tripwire that the `unhandledRejection` guard is armed.
  - `runtime-detect.test.mjs`: spawns the built server under each runtime and checks the startup line carries `plugin.json`'s version (read at runtime from the manifest), and that SIGINT and SIGTERM end in a normal exit 0 (what lets node flush its compile cache).
  - Suites importing the built bundle stay stale until `pnpm run build:universal-format-mcp` is rerun (see `src/universal-format-mcp/CLAUDE.md`).
- **Doc pins:** `scaffold.bats` greps `plugins/universal-format/CLAUDE.md` and `src/universal-format-mcp/CLAUDE.md` for pinned phrases; when you rename a heading there, update the pin in the same change.
- **Run:**

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/universal-format/
pnpm run test:unit
pnpm run typecheck
pnpm run lint
```
