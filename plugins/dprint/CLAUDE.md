# CLAUDE.md — dprint

Skill-only plugin. One model-invocable skill, `init-dprint`
(`skills/init-dprint/SKILL.md`), plus two zero-dep scripts in
`skills/init-dprint/scripts/`, each with a colocated `<name>.reference.md`
contract:

- `check-dprint.mjs`: read-only dprint version probe.
- `dprint-config.mjs`: `detect` (read-only: existing dprint config plus global
  settings from `.editorconfig`, `.gitattributes` and Prettier config) and
  `write` (creates `./.dprint.jsonc` with exclusive create; never overwrites).

No hooks, MCP server, `bin/`, or `userConfig`.

## Minimum version

`MIN_VERSION` is defined only in `skills/init-dprint/scripts/check-dprint.mjs`.
Changing it is a one-line edit there plus the "Minimum dprint version" line in
`README.md`.

## Config step

`dprint-config.mjs` adopts only dprint's four global keys (`lineWidth`,
`indentWidth`, `useTabs`, `newLineKind`) and writes `"plugins": []`.
`DPRINT_CONFIG_PATHS` mirrors dprint's `resolve_main_config_path.rs`, and is searched in the
working directory and every ancestor (as dprint resolves it); style sources are searched up to
the repository root (first directory with `.git`).
`PRETTIER_FILES` is a copy of `PRETTIER_CONFIG_FILENAMES` in
`src/universal-format-mcp/prettier.ts`; nothing checks drift, so update the copy by hand.
`parseEditorconfig` is a reduced copy of `parseEditorconfig`/`normalizeProps`
in `src/universal-format-mcp/editorconfig.ts` (only the literal `[*]` section;
`indent_size=tab` and `max_line_length=off` are skipped). Plugins run from
isolated cache copies, so neither can be imported: when the shared grammar
changes, update this copy by hand.

No bats suite: `test/dprint/` was removed on purpose; do not re-add it or its CI matrix entry.
