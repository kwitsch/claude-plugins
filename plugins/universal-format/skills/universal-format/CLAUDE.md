# CLAUDE.md — universal-format/skills/universal-format

## Skill design (universal-format)

`skills/universal-format/` adds the user-only `/universal-format:universal-format` command: a
free-text file selector → colocated `format-files.mjs` driver. The driver imports `formatPre`,
`formatPost`, `EXT_MAP`, `PRETTIER_LANGS` from `../../mcp/server.mjs` (the committed bundle —
never hand-edited; namespace cast to `any` for typecheck) and reproduces the plugin's **full**
on-write formatting: Prettier languages via `formatPre` (read content → persist the returned
`updatedInput.content`), the 4 CLI languages via `formatPost` (reformats on disk itself). Per-file
fail-open; always exits 0, the printed summary is the signal. `disable-model-invocation: true`
(user-invoke-only); no `userConfig`. Invocation contract in
`skills/universal-format/format-files.reference.md`.
