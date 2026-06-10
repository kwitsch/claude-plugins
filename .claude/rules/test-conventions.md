---
paths:
  - "test/**"
---

# Rule: test suite conventions

## Hermetic

No network in tests. Replace external CLIs with stub executables on an isolated `PATH`. Redirect `$HOME` to a temp dir when hooks read `~/…` paths (e.g. git-sign-key). Installer tests use `--print-*` modes or `CCTOOLS_SKIP_INSTALL=1` — never download.

## Exit codes

Contract-test script exit codes explicitly. Review scripts: missing CLI → 2, no login → 3, failure/hang → 4. Simulate hangs via `timeout`.

## Data files

Larger case sets live in data files next to the suite (e.g. `cctools-edit/bash-guard-corpus.json`, 84 deny/allow cases). Do not inline large case sets in `.bats`.

## Manifest assertions

Pin plugin.json invariants in tests. branch-management: assert exact sorted `userConfig` key list and count — extend the assertion when adding a toggle. Version declared only in `plugin.json`, never in `marketplace.json`.
