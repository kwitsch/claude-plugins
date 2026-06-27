# CLAUDE.md — init

Repo initialization skill collection providing idempotent per-concern skills and a repo-init orchestrator.

## Behavior

Each skill is idempotent — safe to re-run on an already-initialized repo. The orchestrator (`repo-init`) runs all per-concern skills in order: CLAUDE.md creation, .claude/.gitignore setup, codebase-memory indexing, and .lsp.json generation.

## Key files

- `skills/lsp-repo-init/references/lsp-map.json` — canonical map of file extensions to LSP server configs; alias entries are strings (e.g. `".cjs": "vtsls"`), canonical entries are objects.

## Implementation notes

- `claude-repo-init` uses `cc-author` (not `cc-memory`) to create `CLAUDE.md` via the claude-code-knowledge plugin.
- When invoking sub-skills from the orchestrator, use the namespaced form: `init:<skill-name>` (e.g. `init:claude-repo-init`, `init:codebase-repo-init`, `init:lsp-repo-init`).

## Tests

`test/init/test.bats` (bats). Run: `BATS_LIB_PATH=/usr/lib/bats bats test/init/`.
