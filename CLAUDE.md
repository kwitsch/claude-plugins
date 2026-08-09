# CLAUDE.md

Claude Code plugin marketplace.

## Layout

- `.claude-plugin/marketplace.json` — marketplace manifest (root).
- `plugins/<name>/` — one plugin each: `.claude-plugin/plugin.json` + components (`skills/`, `agents/`, `hooks/`, `bin/`, `commands/` legacy, …) + `README.md` + `CLAUDE.md`. Full list in `plugins/CLAUDE.md`.
- `test/<name>/` — per-plugin bats suite (top-level): a single `test.bats`, or split into several thematic `.bats` files (`test-conventions.md`'s "Splitting a large suite") once a suite outgrows one file — `coding-toolbox`, `universal-format`, `universal-lint`, and `npm-automations` are already split. Conventions in `.claude/rules/test-conventions.md`.
- `src/<name>/` — TypeScript sources whose build output is a **committed** plugin artifact; `universal-format` only (`src/universal-format-mcp/` → `plugins/universal-format/mcp/server.mjs` **plus the three committed `.wasm` sidecars `web-tree-sitter.wasm`, `tree-sitter-java_orchard.wasm` and `main.wasm` in that same directory**, bundled by `bun build` and copied by `build.mjs`). The repo-wide convention stays hand-written zero-dep `.mjs`.
- `.claude/rules/` — path-scoped rules loaded by Claude Code when editing matching files (versioning, userConfig, hooks, skills, agents, harness-content language, README sync, test conventions, coderabbit review).
- `.github/workflows/ci.yml` validates manifests; `test.yml` runs bats suites plus a `unit_and_typecheck` job (`pnpm run typecheck` + `pnpm run test:unit`); `tag-on-version-bump.yml` tags plugins whose plugin.json version has no tag yet.

## Testing

```bash
# one-time setup
pnpm install --frozen-lockfile

# run plugin bats suite
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/<name>/

# type-check .mjs files (plugins/, test/)
pnpm run typecheck

# JS unit tests (node:test)
pnpm run test:unit

# lint (dev-time only, not CI-gated on pre-existing files)
pnpm run lint

# rebuild universal-format's committed MCP-server bundle (requires a local bun; CI never runs it)
pnpm run build:universal-format-mcp

# validate marketplace manifest + plugin.json files (mirrors CI)
jq empty .claude-plugin/marketplace.json && \
  jq -e '.name and .owner and (.plugins | type == "array")' .claude-plugin/marketplace.json > /dev/null && \
  for d in plugins/*/; do [ -f "$d/.claude-plugin/plugin.json" ] && jq empty "$d/.claude-plugin/plugin.json"; done
```

Conventions in `.claude/rules/test-conventions.md`.

## Conventions

- Commit messages: never include `Co-Authored-By:` trailer or "Generated with [Claude Code]" footer.
- New plugins: use `create-plugin` skill — scaffolds plugin, test, README, CLAUDE.md, `test.yml` matrix entry, registers in `marketplace.json`.
- Plugin versions ONLY in `.claude-plugin/plugin.json` — no `version` in marketplace.json entries, no `metadata.pluginRoot`. See `.claude/rules/plugin-versioning.md`.
- `docs/` holds local planning artifacts; gitignored, never pushed.
- Plugin dev conventions (structure, `.mjs` hooks) in `plugins/CLAUDE.md`; versioning/userConfig in `.claude/rules/`.
- Script authoring: prefer inline scripts over bundled `.sh` — skills/commands use `!` dynamic-context injection, agents use Bash-run fenced blocks; a dev-time self-test is the inline unit test. See `.claude/rules/script-authoring.md`.
