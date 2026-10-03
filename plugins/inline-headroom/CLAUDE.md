# CLAUDE.md — inline-headroom

Mods-API plugin (the repo's first): one TypeScript function-hooks module, no
skills/agents/command hooks. Two levers, each behind a boolean `userConfig`
toggle (`effort_routing_enabled`, `cache_aligner_enabled`, both `default: true`,
only literal `false` disables), plus the `/headroom` stats command. It also
ships a host-wide SQLite storage MCP server behind the fail-closed
`storage_enabled` toggle (see `## Storage server`); nothing in the mod uses it yet.

## Layout

- `.mcp.json` — registers `mcp/server.mjs` directly (no wrapper, no args) under
  the key `storage`, with env `INLINE_HEADROOM_STORAGE_ENABLED` =
  `${user_config.storage_enabled}`. `CLAUDE_PLUGIN_DATA` gets no `env` entry:
  Claude Code exports it to stdio MCP servers.
- `mcp/server.mjs` — the storage server: one zero-dep executable `.mjs`
  (`100755`, `#!/usr/bin/env node`) with two modes, the per-session stdio MCP
  front-end and the detached `--service <dataDir>` singleton. Its pure exports
  (`isStorageEnabled`, `resolveStorage`, `migrate`, `execOp`, `PROTOCOL`,
  `MIGRATIONS`) are tested by `test/inline-headroom/storage.test.mjs`; an
  `isMainModule()` guard keeps that import free of side effects.
- `hooks/hooks.json` — exactly `{"modules": ["./register.ts"]}`.
- `hooks/register.ts` — every hook and every `$` use, typed via
  `import type { Register } from 'claude-code'`. No `any`, no `import()` (a module
  holding `import()` does not load).
- `hooks/policy.mjs` — pure, zero-dep, JSDoc-typed logic. It must never reference
  `$`: the engine rejects passing the mods API into functions imported from
  another file. It is `.mjs` (not `.ts`) so the root toolchain covers it in CI:
  `tsconfig.json` (`plugins/**/*.mjs`), ESLint, and `node --test` via
  `test/inline-headroom/policy.test.mjs`.
- `tests/inline-headroom.test.ts` — hook-wiring tests for `claude plugin test`.
  Local only: CI runners have no `claude` CLI; `test/inline-headroom/test.bats`
  runs `claude plugin validate` and `claude plugin test` when `claude`
  is on `PATH` and skips them otherwise.
- `.claude-plugin/types/` is written by the engine (typings + tsconfig) at every
  `claude --plugin-dir` load and is gitignored (`plugins/*/.claude-plugin/types/`).
  No committed per-mod `tsconfig.json`.

## Tests

```bash
# CI (Node 24): policy.mjs and the storage server (test/inline-headroom/*.test.mjs)
pnpm run test:unit
# CI: manifest and wiring only
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/inline-headroom/
# local only
claude plugin validate plugins/inline-headroom && claude plugin test plugins/inline-headroom
```

Every test that needs `node:sqlite` or spawns processes lives in
`storage.test.mjs`: the CI bats job runs on the runner's default Node without
`setup-node`. Its cleanup SIGTERMs every `--service` process for its temp data
dir, so no daemon outlives the suite.

The bats version-pin test (`plugin.json version is 0.2.0`) is a rolling pin:
every version bump rewrites its name and expected value in the same commit.

## Storage server

Invariants for `mcp/server.mjs`:

- Node built-ins only (`node:` imports), no npm dependency, no bundling, one file.
- No static `node:sqlite` import. Only `--service` mode loads it via
  `await import("node:sqlite")`, so the front-end starts on any Node. Storage
  needs Node >= 22.13; Bun lacks `node:sqlite`, so there is no
  `bin/mjs-launch.sh`.
- All SQLite access happens in the `--service` process. It holds `storage.db`
  under `PRAGMA locking_mode=EXCLUSIVE` + `journal_mode=WAL` from start to exit.
  That lock is the host-wide election: a second service gets `SQLITE_BUSY` and
  exits 0. Only the lock holder unlinks a stale `storage.sock` and listens.
- Front-end stdout carries JSON-RPC only; the per-call debug log is gated by
  `MCP_HOOK_DEBUG`. The service never writes stdout; its stderr is
  `${CLAUDE_PLUGIN_DATA}/service.log`.
- Linux, macOS and WSL2 only: the service socket is a path-based Unix socket, so
  `callService` refuses on `win32` (native Windows is a spec non-goal; its
  `net.listen` would need a `\\.\pipe\` name). `storage_enabled` still defaults to
  `true` there; calls just return the "unsupported" error.
- Data lives only under `CLAUDE_PLUGIN_DATA` (`storage.db`, `storage.sock`,
  `service.log`). There is no fallback directory: an unset, blank or
  uninterpolated value refuses storage.
- `storage_enabled` is fail-closed (only the trimmed literal `"true"` enables)
  under the state-creating exception of `.claude/rules/plugin-userconfig.md`.
  Disabled means `tools/list` is `[]` and no file or process is created.
- The front-end retries only `ENOENT`/`ECONNREFUSED` (nothing was sent), so a
  write is never applied twice.
- `PROTOCOL` (an integer, now `1`) must be bumped on any op or schema change. A
  newer front-end SIGTERMs an older service; an older front-end refuses a newer
  one. `MIGRATIONS` is append-only and additive: never edit, reorder or remove an
  entry. `migrate` refuses a schema newer than the code.
- `execOp` is the single trust boundary: keys 1–512 chars, values at most
  1 MiB serialized JSON, requests at most 2 MiB.

Key naming convention for consumers (documented, not enforced): a `<feature>/`
prefix, e.g. `stats/<sessionId>`. A feature that needs a table, `kv_list` or a
query adds a new `MIGRATIONS` entry and op plus a `PROTOCOL` bump.

Deviation from `.claude/rules/hooks-mcp-server.md`: the `.mcp.json` key is
`storage`, not `<name>-hooks`, because this server backs no `mcp_tool` hook and
`hooks.json` never references it. The first consumer must verify
`$.mcp.connect("storage")` from the mod live.

## Verified Claude Code 2.1.288 shapes relied on

- `turn.step` input `effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number`;
  `index: number` (0 = the user-ask step); `agentId?: string` set for subagents.
- `tool.call` result: failure is `isError: true` or `deny: string`; there is no
  `exitCode` (a failing Bash command surfaces as `isError: true`).
- `PromptComposeSection.scope` is `'shared' | 'session'`; `prompt.compose` returns
  `{ sections }` and this mod returns `next(e)`'s result unchanged.
- `turn.step` result `usage` may be `null`.
- `command.run` returning `{}` prints no transcript row and records no model
  context (`CommandRunResult.text` absent).
- `$.ui.open(PaneOpenArgs)` resolves to `UiOpenResult`
  (`{ isPlaced: true } | { isPlaced: false, reason }`). `focus`/`closeOnEscape`
  accept only `true`. One pane per id, and re-opening retitles it.
- The `ui.render` matcher `{ component: "Pane", requestId }` selects only that
  pane and scopes `$.ui.invalidate("ui.render")` to it. Elements come from
  `$.ui.resolve(e)` as plain function calls (`Box({...})`, `Text({ children: [...] })`),
  so the module stays `.ts` without JSX.
- Test kit: `$.ui.open` needs an `on("ui.open", ...)` stub answering
  `{ value: { isPlaced: true } }`, registered before the test's first `$` call.
  The kit answers `$.ui.invalidate` itself. Panes are asserted with
  `$.ui.mount(...)` and `find({ type: "Text", text })`.

## Effort-routing caveat

Upstream headroom removed effort routing after measurement (~$0.0007 saved per
mechanical turn vs ~$0.011 cache re-write per effort switch). `effort_routing_enabled`
still defaults to `true` per `.claude/rules/plugin-userconfig.md`; the separate
toggle, the per-step `cache drop` log and the `/headroom` drop count are how a user
measures whether it pays off.

## Releases

Never use `claude plugin tag`: its `{name}--v{version}` tag scheme conflicts with
`tag-on-version-bump.yml`, which tags `<name>-<version>` from the `plugin.json`
version.
