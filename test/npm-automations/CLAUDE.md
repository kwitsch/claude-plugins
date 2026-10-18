# CLAUDE.md — test/npm-automations

## Tests

- `test_helper.bash` holds the shared helpers.
  - `common_setup`: isolated `$HOME`, plus `$REPO_ROOT` / `$PLUGIN` / `$HOOKS`.
  - `rg_or_grep`: ripgrep with a grep fallback.
- Each `.bats` file loads it via `load 'test_helper'` and declares its own `setup() { common_setup; }` (bats has no cross-file `setup()`).
- `manifest.bats` covers plugin.json / marketplace / root-README / `test.yml`-matrix invariants, generic README structure, the mods wiring (`hooks.json` module list, mod files present, `policy.mjs` `100755` in the index) and runs `claude plugin validate` / `claude plugin test` when `claude` is on `PATH` (skipped otherwise, as in CI).
- `policy.test.mjs`: unit-level `node:test` for `plugins/npm-automations/hooks/policy.mjs` (every install/ci decision and message).
- Hook wiring (`$.process.run` argv, toggles, the per-directory chain, the `$.session.append` line) lives in `plugins/npm-automations/tests/npm-automations.test.ts`, run by `claude plugin test`.
- The bats version-pin test (`plugin.json version is X.Y.Z`) is a rolling pin: every version bump rewrites its name and expected value in the same commit.

## Run

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/npm-automations/
pnpm run test:unit
# local only
claude plugin validate plugins/npm-automations && claude plugin test plugins/npm-automations
```
