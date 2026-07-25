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

Larger case sets live in data files next to the suite (e.g. `coding-toolbox/encoding-guard-corpus.json`). Do not inline large case sets in `.bats`.

## Manifest assertions

Pin plugin.json invariants in tests. branch-management: assert exact sorted `userConfig` key list and count — extend the assertion when adding a toggle. Version declared only in `plugin.json`, never in `marketplace.json`.

## Inline scripts

Trivial inline scripts — skill/command `!` dynamic-context blocks and short
agent fenced bash with no control flow — are **not** covered by bats. Their
validation is the author's dev-time self-test (run it, confirm output), per
the script-authoring rule.

A script extracted to a standalone file (a skill/command's own
`<script>.<ext>`/`scripts/<script>.<ext>`, or a plugin's `bin/` executable)
gets bats coverage exactly like any other `bin/` executable — invoke the
real file, assert output/exit codes/file mutations. Hermetic rules (stub
CLIs on `PATH`, redirect `$HOME`/`TMPDIR`) apply identically.
