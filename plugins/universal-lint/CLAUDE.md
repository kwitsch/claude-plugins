# CLAUDE.md — universal-lint

A `PostToolUse` `Write|Edit` `mcp_tool` hook (`lint_file`) that runs each language's standard linter (check-only) on the just-written file.

## Behavior
`mcp/server.mjs` is a self-contained, zero-dependency MCP stdio server exposing `lint_file`. It never passes `--fix`/`--format`/`--write`-equivalent flags to any linter. Every guard failure, crash, timeout, or clean lint result returns `{}` silently (fail open). Findings are surfaced via `additionalContext`.

## Tests
`test/universal-lint/test.bats` (bats) + `test/universal-lint/registry.test.mjs` (`node --test`). Run: `BATS_LIB_PATH="$PWD/node_modules" npx bats test/universal-lint/`.
