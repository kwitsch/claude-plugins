# CLAUDE.md — test/npm-automations

## Tests

- `test_helper.bash` holds the shared helpers.
  - `common_setup`: isolated `$HOME`, plus `$REPO_ROOT` / `$PLUGIN` / `$HOOKS`.
  - `rg_or_grep`: ripgrep with a grep fallback.
- Each `.bats` file loads it via `load 'test_helper'` and declares its own `setup() { common_setup; }` (bats has no cross-file `setup()`).
- `manifest.bats` covers plugin.json / marketplace / root-README / `test.yml`-matrix invariants and generic README structure.
- Each hook has a pair:
  - `<hook>.bats`: process-level, end-to-end behavior.
  - `<hook>.test.mjs`: unit-level `node:test` for the pure functions.

## Run

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/npm-automations/
pnpm run test:unit
```
