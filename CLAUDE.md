# CLAUDE.md

Claude Code plugin marketplace.

## Layout

- Plugins live in `plugins/<name>/` (conventions: `plugins/CLAUDE.md`), each with a bats suite in `test/<name>/` (conventions: `.claude/rules/test-conventions.md`).
- `src/<name>/` holds TypeScript sources whose build output is a **committed** plugin artifact — `universal-format` only; the repo-wide convention stays hand-written zero-dep `.mjs`. Editing `src/` requires `pnpm run build:universal-format-mcp` before commit — see `plugins/universal-format/CLAUDE.md` and `src/universal-format-mcp/CLAUDE.md`. `inline-headroom` is a TypeScript mods module (`hooks/register.ts`), another exception to the zero-dep `.mjs` convention — see `plugins/inline-headroom/CLAUDE.md`.
- `.claude/rules/` — path-scoped rules, loaded when Claude edits matching files.
- `tag-on-version-bump.yml` tags any plugin whose `plugin.json` version has no tag yet.

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

# mods plugin wiring (local only — needs the claude CLI, not run in CI)
claude plugin validate plugins/inline-headroom && claude plugin test plugins/inline-headroom

# validate marketplace manifest + plugin.json files (mirrors CI)
jq empty .claude-plugin/marketplace.json \
  && jq -e '.name and .owner and (.plugins | type == "array")' .claude-plugin/marketplace.json > /dev/null \
  && for d in plugins/*/; do [ -f "$d/.claude-plugin/plugin.json" ] && jq empty "$d/.claude-plugin/plugin.json"; done
```

## Conventions

- Commit messages: never include `Co-Authored-By:` trailer or "Generated with [Claude Code]" footer. `.claude/settings.json` also blanks the built-in `attribution`.
- New plugins: use `create-plugin` skill — scaffolds plugin, test, README, CLAUDE.md, `test.yml` matrix entry, registers in `marketplace.json`.
- Plugin versions live ONLY in `.claude-plugin/plugin.json`, never in `marketplace.json` entries. See `.claude/rules/plugin-versioning.md`.
- `docs/` holds local planning artifacts; gitignored, never pushed.
- Script authoring: trivial scripts stay inline (skills/commands use `!` dynamic-context injection, agents use Bash-run fenced blocks); substantial scripts go to a standalone file per `.claude/rules/script-authoring.md`.
