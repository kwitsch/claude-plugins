---
paths:
  - "test/**"
---

# Rule: test suite conventions

## Hermetic

- No network in tests.
- Replace external CLIs with stub executables on an isolated `PATH`.
- Redirect `$HOME` to a temp dir when hook scripts read `~/…` paths; a mods module mocks `$.env`/`$.fs` in its `claude plugin test` instead.
- Installer tests use `--print-*` modes or `CCTOOLS_SKIP_INSTALL=1` — never download.

## Exit codes

- Contract-test script exit codes explicitly.
- Simulate hangs via `timeout`.
- There is no repo-wide exit-code scheme; each script's own documented contract (its colocated `.reference.md` or header comment) is the one to test.

## Data files

Larger case sets live in data files next to the suite (e.g. `coding-toolbox/encoding-guard-corpus.json`). Do not inline large case sets in `.bats`.

## Manifest assertions

- Pin plugin.json invariants in tests: for a plugin with `userConfig`, assert the exact sorted key list and count — extend the assertion when adding a toggle.
- Version declared only in `plugin.json`, never in `marketplace.json`.
- A hardcoded version-pin test (`plugin.json version is X.Y.Z`) is a rolling pin, not a one-off: every version bump rewrites that same test's name and expected value in the same commit as the bump (never deletes it — it's the CI safety net that catches a missed bump). See `.claude/rules/plugin-versioning.md`.

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

## Splitting a large suite

`bats <dir>` (CI's own invocation) runs every `.bats` file in a directory, so an
oversized suite splits into one file per thematic group with no CI change. Only
helpers shared by 2+ groups go into `test_helper.bash` (`load 'test_helper'`);
each file still declares its own `setup()`. Worked example and rationale:
`test/coding-toolbox/CLAUDE.md`.
