# CLAUDE.md — universal-format/skills/universal-format

## Skill design (universal-format)

- `skills/universal-format/` adds the user-only `/universal-format:universal-format` command: a free-text file selector → colocated `format-files.mjs` driver.
- The driver imports `formatPre` and `EXT_MAP` from `../../mcp/server.mjs` (the committed bundle — never hand-edited; namespace cast to `any` for typecheck).
- It reproduces the plugin's **full** on-write formatting for all 17 languages through the one hook handler: read the file, call `formatPre` as a `Write` would, persist the returned `updatedInput.content` (prettier languages in-process, the 4 CLI languages through their tool on stdin — same code path).
- Per-file fail-open; always exits 0, the printed summary is the signal.
- `disable-model-invocation: true` (user-invoke-only); no `userConfig`.
- Invocation contract in `skills/universal-format/format-files.reference.md`.
