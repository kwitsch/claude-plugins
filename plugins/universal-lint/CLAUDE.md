# CLAUDE.md — universal-lint

Hooks-only plugin: a PostToolUse `Write|Edit` `command` hook runs the just-written file's standard linter (check-only, never `--fix`/`--format`/`--write`) for Shell/Java/Kotlin/JS-TS/Python/Go/YAML/Markdown/CSS/SCSS/PHP, backed by a self-contained zero-dep `hooks/lint-file.mjs`. TypeScript files (`.ts`/`.tsx`/`.mts`/`.cts`) additionally get a whole-project `tsc --noEmit` type-check. JSON is deliberately excluded. No `userConfig` — the hook is always active once the plugin is installed.

See `plugins/universal-lint/hooks/CLAUDE.md` for hook design detail (do not "fix" any of it without reading that file first): the no-toggle rationale, runtime behavior, path exclusions, `tsc` type-checking, the YAML/Markdown line-length guard, PHP, Rust, and why JSON isn't covered.

## Skills

See `plugins/universal-lint/skills/universal-lint/CLAUDE.md` for the `/universal-lint:universal-lint` skill design.

## Tests

See `test/universal-lint/CLAUDE.md` for the suite layout and run commands.
