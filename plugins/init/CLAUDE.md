# CLAUDE.md — init

Repo initialization skill collection providing idempotent per-concern skills and a repo-init orchestrator.

## Behavior

Each skill is idempotent — safe to re-run on an already-initialized repo. The orchestrator (`repo-init`) runs all per-concern skills in order: CLAUDE.md creation, .claude/.gitignore setup, codebase-memory indexing, and .lsp.json generation.

## Tests

`test/init/test.bats` (bats). Run: `BATS_LIB_PATH=/usr/lib/bats bats test/init/`.
