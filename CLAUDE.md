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
- Plugin versions live ONLY in the plugin's `.claude-plugin/plugin.json` — marketplace.json entries carry no `version` (plugin.json wins silently anyway; CI fails when an entry declares one or a plugin.json lacks one). Plugin sources resolve relative to `metadata.pluginRoot` (`./plugins`) in marketplace.json.
- `docs/` holds local planning artifacts; it is gitignored and never pushed.

## Tests
Run a suite locally: `npm ci && BATS_LIB_PATH="$PWD/node_modules" npx bats test/<name>/`.
