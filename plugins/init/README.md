# init

Repo initialization skill collection — CLAUDE.md, .claude/.gitignore, codebase-memory index, and .lsp.json creation via idempotent per-concern skills and a repo-init orchestrator.

## Install

```
/plugin install init@kwitsch-plugins
```

## What it does

Provides a set of idempotent per-concern initialization skills (CLAUDE.md creation, .claude/.gitignore setup, codebase-memory indexing, .lsp.json generation) plus a `repo-init` orchestrator skill that runs them all in sequence for a fresh repository setup.
