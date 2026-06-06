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
- Version bumps: update the plugin's `.claude-plugin/plugin.json` AND its entry in `.claude-plugin/marketplace.json` together — CI fails when they diverge.
- `docs/` holds local planning artifacts; it is gitignored and never pushed.

## Tests
Run a suite locally: `npm ci && BATS_LIB_PATH="$PWD/node_modules" npx bats test/<name>/`.
