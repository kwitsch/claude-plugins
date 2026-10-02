# claude-code-knowledge — dev notes

## Boundary rule

The plugin ships these components (mechanics live in each `SKILL.md` / agent file):

- `skills/cc-reference/` — lookup skill + bundled reference files.
- `skills/cc-review/` — inline review orchestrator; dispatches `cc-reviewer`.
- `skills/cc-author/` — inline authoring orchestrator; dispatches `cc-author-planner`.
- `skills/memory-audit/` — inline project-memory audit-and-improve orchestrator; reuses `cc-reviewer` with `component_type: memory`.
- `skills/cc-compress/` — compresses a memory/instruction file in place via `scripts/compress.mjs`; adaptation of upstream `caveman-compress` (JuliusBrussee/caveman).
- `skills/lsp-audit/` — adds missing LSP coverage to the project-scope `lsp` plugin (`<project-root>/.claude/skills/lsp/`); see `skills/lsp-audit/CLAUDE.md`.
- `skills/repository-audit/` — inline full-audit orchestrator: structure check, `lsp-audit`, `memory-audit`, dev-tool detection offering an `init-dev-environment` skill; see `skills/repository-audit/CLAUDE.md`.
- `agents/claude-code-expert.md` — read-only Q&A expert (reroute target).
- `agents/cc-reviewer.md` — read-only review worker dispatched by `cc-review`.
- `agents/cc-author-planner.md` — read-only authoring planner dispatched by `cc-author`; never writes.
- `hooks/hooks.json` + `mcp/server.mjs` + `.mcp.json` — `claude-code-guide` reroute hook backend; see `mcp/CLAUDE.md`.

Constraints:

- Adding further components requires a deliberate design decision.
- Maintenance tooling (`.claude/skills/update-cc-references/` and the `.claude/agents/cc-reference-validator.md` agent its validation gate dispatches) lives at the repo root and does NOT ship — the plugin loader reads only the plugin's own directories.
- `cc-author`/`memory-audit`/`cc-author-planner` extend the lookup→review pair into lookup→author→review, all sourced from `cc-reference` — no duplicated reference files.
- `claude-code-expert` answers only from `cc-reference` — never from training memory; it reaches live docs only through `cc-reference`'s WebFetch fallback.
- `memory-audit`, `lsp-audit` and `repository-audit` deliberately drop the `cc-*` skill-name prefix — an intentional symmetry break, not an oversight; do not "restore" a `cc-` prefix.
- The `lsp-audit` catalog (`scripts/lsp-map.json`) is operational data (like `universal-lint`'s linter map), not duplicated `cc-reference` knowledge.

## Reference-file authoring style

See `plugins/claude-code-knowledge/skills/cc-reference/references/CLAUDE.md` for the authoring conventions the reference files under `skills/cc-reference/references/` must follow.

## Versioning

Version lives ONLY in `.claude-plugin/plugin.json`. Rules:

- Patch-bump on any reference-file refresh (handled automatically by `update-cc-references`, which also stamps the ingestion date into the plugin `description`).
- Do NOT put a `version` field in the marketplace.json entry for this plugin.
- Do NOT create git tags manually — CI (`tag-on-version-bump.yml`) tags after merge.

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/claude-code-knowledge/
```

The suite is structural: it checks the plugin manifest, the cc-reference skill shape, the reference files under `references/` (incl. the `references/` layout convention + `skill-folder-structure.md`), the expert agent, the mcp_tool reroute server, and that the update-cc-references maintenance skill is present but user-only.

## rtk does not apply

- The fetch-variant components (`claude-code-expert`, `cc-author-planner`, `cc-reviewer`, `cc-reference`) fall back to WebFetch — a problem domain `rtk` (a shell-command proxy) has no role in.
- The shell-variant skills (`cc-review`, `memory-audit`) have no rtk-optimizable command: `memory-audit`'s `find` call was tested directly and `rtk find` refuses it outright for its compound predicates (`-o`, `-not`).
