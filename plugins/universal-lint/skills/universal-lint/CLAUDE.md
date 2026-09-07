# CLAUDE.md — universal-lint/skills/universal-lint

## Skill design (universal-lint)

`skills/universal-lint/` adds the user-only `/universal-lint:universal-lint` command: a free-text
file selector → colocated `lint-files.mjs` driver. The driver imports `lintFileHandler` (exported
from `hooks/lint-file.mjs` — `main()` stays its sole hook entry point, and the export is the one
additive change to that file) and calls it per file, collecting each
`hookSpecificOutput.additionalContext` into one aggregated, read-only report. Importing the handler
bypasses `main()`'s 5s debounce (which lives only in `main()`/`debounceGate`, not the handler), so
the hook's debounce-window env override is irrelevant here. Read-only — the driver never runs an autofix path.
Per-file fail-open; always exits 0. `disable-model-invocation: true` (user-invoke-only); no
`userConfig`. Invocation contract in `skills/universal-lint/lint-files.reference.md`.
