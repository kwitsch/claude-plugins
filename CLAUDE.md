# CLAUDE.md

Claude Code plugin marketplace.

## Layout
- `.claude-plugin/marketplace.json` — marketplace manifest (root).
- `plugins/<name>/` — one plugin each: `.claude-plugin/plugin.json` + components (`skills/`, `agents/`, `hooks/`, `bin/`, `commands/` legacy, …) + `README.md` + `CLAUDE.md`. Full list in `plugins/CLAUDE.md`.
- `test/<name>/test.bats` — per-plugin bats suite (top-level); conventions in `test/CLAUDE.md`.
- `.github/workflows/ci.yml` validates manifests; `test.yml` runs bats suites; `tag-on-version-bump.yml` tags plugins whose plugin.json version has no tag yet.

## Testing
```bash
npm ci   # once
BATS_LIB_PATH="$PWD/node_modules" npx bats test/<name>/
```
Conventions in `test/CLAUDE.md`.

## Conventions
- Commit messages: never include `Co-Authored-By:` trailer or "Generated with [Claude Code]" footer.
- New plugins: use `create-plugin` skill — scaffolds plugin, test, README, CLAUDE.md, `test.yml` matrix entry, registers in `marketplace.json`.
- Plugin versions ONLY in `.claude-plugin/plugin.json` — marketplace.json entries carry no `version` (plugin.json wins silently; CI fails when entry declares one or plugin.json lacks one). marketplace.json sources use full `./plugins/<name>` paths — do NOT use `metadata.pluginRoot`: documented but broken in Claude Code (install/update ignores it for `./` sources, bare names hit unsupported-source-type error; see anthropics/claude-code#61224 and #64431). Reintroduce only after #61224 fixed.
- `docs/` holds local planning artifacts; gitignored, never pushed.
- Plugin dev conventions (userConfig feature toggles, `.mjs` hooks) in `plugins/CLAUDE.md`; test conventions + local run command in `test/CLAUDE.md`.

## graphify

Knowledge graph at `graphify-out/` — god nodes, community structure, cross-file relationships.

Rules:
- Codebase questions: first run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for relationships, `graphify explain "<concept>"` for focused concepts. Returns scoped subgraph — smaller than GRAPH_REPORT.md or grep.
- If `graphify-out/wiki/index.md` exists, use for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain surface insufficient context.
- After modifying code, run `graphify update .` to keep graph current (AST-only, no API cost).