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
`README.md`; the equal-version bats test reads the value from the script.

## Config step

`dprint-config.mjs` adopts only dprint's four global keys (`lineWidth`,
`indentWidth`, `useTabs`, `newLineKind`) and writes `"plugins": []`.
`DPRINT_CONFIG_PATHS` mirrors dprint's `resolve_main_config_path.rs`.
`PRETTIER_FILES` is a copy of `PRETTIER_CONFIG_FILENAMES` in
`src/universal-format-mcp/prettier.ts`; a bats test fails when the two drift.
`parseEditorconfig` is a reduced copy of `parseEditorconfig`/`normalizeProps`
in `src/universal-format-mcp/editorconfig.ts` (only the literal `[*]` section;
`indent_size=tab` and `max_line_length=off` are skipped). Plugins run from
isolated cache copies, so neither can be imported: when the shared grammar
changes, update this copy by hand.

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/dprint/
```

`test/dprint/test.bats` holds manifest/registration/SKILL.md static checks;
`test/dprint/check-dprint.bats` holds the version-probe contract tests (stub
`dprint` on an isolated `PATH`, `HOME` redirected); `test/dprint/dprint-config.bats`
holds the detect/write contract tests (fixtures in a temp project dir). The
version-pin test is a **rolling pin**: it asserts the exact `plugin.json`
version. Any future version bump MUST update that assertion in the same commit,
or CI turns red.
