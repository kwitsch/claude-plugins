# CLAUDE.md — inline-headroom

Mods-API plugin (the repo's first): one TypeScript function-hooks module, no
skills/agents/command hooks. Two levers, each behind a boolean `userConfig`
toggle (`effort_routing_enabled`, `cache_aligner_enabled`, both `default: true`,
only literal `false` disables), plus the `/headroom` command, which opens a stats pane.

## Layout

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
pnpm run test:unit # policy.mjs (CI)
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/inline-headroom/
claude plugin validate plugins/inline-headroom && claude plugin test plugins/inline-headroom # local only
```

The bats version-pin test (`plugin.json version is 0.2.0`) is a rolling pin:
every version bump rewrites its name and expected value in the same commit.

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
