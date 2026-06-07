# CLAUDE.md — test/

One bats suite per plugin: `test/<name>/test.bats`, run by `.github/workflows/test.yml` (matrix entry per plugin — `create-plugin` scaffold it).

## Run
```bash
npm ci   # once — installs bats into node_modules
BATS_LIB_PATH="$PWD/node_modules" npx bats test/<name>/
```

## Conventions
- Hermetic — no network. External CLIs replaced by stub executables on isolated `PATH`; `$HOME` redirected to temp dir when hooks read `~/…` (git-sign-key); installer tests use `--print-*` modes / `CCTOOLS_SKIP_INSTALL=1` instead of downloading.
- Script exit codes contract-tested (e.g. review scripts: missing CLI → 2, no login → 3, failure/hang → 4; hangs via `timeout`).
- Larger case sets live in data files next to suite (e.g. `cctools-edit/bash-guard-corpus.json`, 84 deny/allow cases).
- Manifest assertions pin plugin.json invariants (branch-management: exact sorted `userConfig` key list + count — extend when adding toggle; version declared only in plugin.json, never in marketplace.json).