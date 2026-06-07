# CLAUDE.md

Claude Code plugin marketplace.

## Layout
- `.claude-plugin/marketplace.json` — marketplace manifest (root).
- `plugins/<name>/` — one plugin each: `.claude-plugin/plugin.json` + components (`commands/`, `hooks/`, …) and a `README.md` + `CLAUDE.md`.
- `test/<name>/test.bats` — per-plugin bats suite (top-level).
- `.github/workflows/ci.yml` validates manifests; `test.yml` runs the bats suites.

## Conventions
- Commit messages: never include a `Co-Authored-By:` trailer or the "Generated with [Claude Code]" footer.
- New plugins: use the `create-plugin` skill — it scaffolds the plugin, test, README, CLAUDE.md, and the `test.yml` matrix entry, and registers the plugin in `marketplace.json`.
- Plugin versions live ONLY in the plugin's `.claude-plugin/plugin.json` — marketplace.json entries carry no `version` (plugin.json wins silently anyway; CI fails when an entry declares one or a plugin.json lacks one). Plugin sources in marketplace.json use full `./plugins/<name>` paths — do NOT use `metadata.pluginRoot`: it is documented but broken in Claude Code (install/update ignores it for `./` sources, bare names hit an unsupported-source-type error; see anthropics/claude-code#61224 and #64431). Reintroduce only after #61224 is fixed.
- `docs/` holds local planning artifacts; it is gitignored and never pushed.

## Tests
Run a suite locally: `npm ci && BATS_LIB_PATH="$PWD/node_modules" npx bats test/<name>/`.
