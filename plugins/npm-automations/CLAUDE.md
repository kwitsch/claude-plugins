# CLAUDE.md — npm-automations

Mods-API plugin (no skills/agents/command hooks) centralizing npm-lifecycle
automation: one TypeScript function-hooks module (`hooks/register.ts`) with pure
logic in `hooks/policy.mjs`, the repo's second mods plugin after
`inline-headroom` (same layout rules, see `plugins/inline-headroom/CLAUDE.md`).
Both hooks are independently gated by a fail-open `userConfig` boolean
(`default: true`, only a literal `false` disables), read from `register`'s
`options`.

## Hooks

See `plugins/npm-automations/hooks/CLAUDE.md` for the module layout, the shared hook flow, package-manager detection, toggles and install serialization, and both hooks' (`npm-ci-on-worktree`, `npm-install-on-package-change`) individual design detail. The two names survive as the prefixes of the context lines the hooks leave for the model.

## Tests

See `test/npm-automations/CLAUDE.md` for the suite layout and run commands. `tests/npm-automations.test.ts` holds the hook-wiring tests for `claude plugin test` (local only: CI has no `claude` CLI).
