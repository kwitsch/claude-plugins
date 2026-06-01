# Design: Plugin-Tests in Top-Level `test/` + CI-Matrix

**Date:** 2026-06-01
**Status:** Approved
**Branch:** `feat/no-co-authored-plugin` (integrated into PR #4)

## Summary

Move per-plugin tests out of the plugin tree into a dedicated top-level `test/`
directory (one subdirectory per plugin, named after the plugin), mirroring the
layout of `kwitsch/devcontainer-features`. Add a separate CI workflow that runs
each plugin's test suite on pull requests via a build matrix.

## Motivation

Tests currently live beside the plugin code at
`plugins/no-co-authored/hooks/test/run-tests.sh` and are never run in CI. A
single top-level `test/` tree makes test discovery obvious, separates test
fixtures from shipped plugin code, and lets CI execute every plugin's suite on
each PR.

## Scope decision

The reference repo (`kwitsch/devcontainer-features`) drives its tests with the
`devcontainer features test` CLI (Docker containers, the
`dev-container-features-test-lib` `check`/`reportResults` helpers). That
framework is **not** applicable here — Claude Code plugins have no container
install lifecycle. We adopt only the **structural pattern** (top-level
`test/<name>/`) and **CI execution on PR**, while keeping our own self-contained
Bash test scripts.

## Directory layout

```
test/
└── no-co-authored/
    └── test.sh        # moved from plugins/no-co-authored/hooks/test/run-tests.sh
```

- Top-level `test/<plugin-name>/`, mirroring the plugin name (analogous to
  devcontainer-features `test/<feature>/`).
- The per-plugin test script is named `test.sh` (devcontainer-features
  convention).
- Plugins without tests simply have no `test/<plugin>/` directory.
- Plugin code (`strip-coauthor.sh`, `hooks.json`) stays unchanged under
  `plugins/no-co-authored/hooks/`. The old `plugins/no-co-authored/hooks/test/`
  directory is removed.

## Test script path adjustment

Only the reference to the plugin code changes; the 12 test cases are unchanged.
The current script resolves the hook relative to its old location
(`${HERE}/../strip-coauthor.sh`). After the move, `test/no-co-authored/test.sh`
resolves the repo root (two levels up) and references the plugin path:

```bash
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
HOOK="$REPO_ROOT/plugins/no-co-authored/hooks/strip-coauthor.sh"
```

Everything else (`make_input`, `run_hook`, `assert_silent`, `assert_rewritten`,
the fixtures, and the 12 assertions) is copied verbatim.

## CI workflow: `.github/workflows/test.yml`

A new workflow, separate from `ci.yml` (which keeps doing marketplace
validation).

- **Triggers:** `pull_request`, `push` to `main`, `workflow_dispatch`.
- **Matrix:** **static** list of plugins that have a test suite. Adding a new
  tested plugin requires adding its name to this list (accepted maintenance
  cost). A comment in the workflow documents this.
- **Job:** one matrix leg per plugin runs `bash test/<plugin>/test.sh`.
- `fail-fast: false` so one failing plugin does not cancel the others.
- `jq` is preinstalled on `ubuntu-latest` (the test harness uses it).

```yaml
name: Test

on:
  pull_request:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix:
        # Add a plugin here when it gains a test/<plugin>/test.sh suite.
        plugin:
          - no-co-authored
    steps:
      - uses: actions/checkout@v4
      - name: Run ${{ matrix.plugin }} test suite
        run: bash "test/${{ matrix.plugin }}/test.sh"
```

## Test framework

Stays our own, self-contained Bash (`pass`/`fail`/`assert_silent`/
`assert_rewritten`). No devcontainer CLI, no Docker, no shared test library
(YAGNI — a single tested plugin; each `test.sh` is independent).

## Branch / integration

Implemented on the existing `feat/no-co-authored-plugin` branch and folded into
PR #4, because the test script being moved was introduced in that same PR. No
cross-branch dependency.

## Out of scope

- A shared test helper library.
- Dynamic matrix discovery (chosen: static list).
- Testing `example-plugin` (it has no tests).
- Changing the plugin code or `ci.yml`.
