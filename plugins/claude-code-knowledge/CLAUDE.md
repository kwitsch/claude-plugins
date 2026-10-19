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
- `hooks/` — the `claude-code-guide` reroute mod; see `## Reroute mod`.

Constraints:

- Adding further components requires a deliberate design decision.
- Maintenance tooling (`.claude/skills/update-cc-references/` and the `.claude/agents/cc-reference-validator.md` agent its validation gate dispatches) lives at the repo root and does NOT ship — the plugin loader reads only the plugin's own directories.
- `cc-author`/`memory-audit`/`cc-author-planner` extend the lookup→review pair into lookup→author→review, all sourced from `cc-reference` — no duplicated reference files.
- `claude-code-expert` answers only from `cc-reference` — never from training memory; it reaches live docs only through `cc-reference`'s WebFetch fallback.
- `memory-audit`, `lsp-audit` and `repository-audit` deliberately drop the `cc-*` skill-name prefix — an intentional symmetry break, not an oversight; do not "restore" a `cc-` prefix.
- The `lsp-audit` catalog (`scripts/lsp-map.json`) is operational data (like `universal-lint`'s linter map), not duplicated `cc-reference` knowledge.

## Reroute mod

A mods function-hooks module (layout and module rules as `plugins/inline-headroom/CLAUDE.md`); no hook process, no MCP server.

- `hooks/hooks.json` — exactly `{"modules": ["./register.ts"]}`.
- `hooks/register.ts` — one `tool.call` hook, matcher `{ tool: ["Agent", "Task"] }`. It calls `next` with `subagent_type` from `rerouteType`; every other call passes as is.
- `hooks/reroute.mjs` — pure, zero-dep, JSDoc-typed (`normalize`, `rerouteType`, `REROUTE_TARGET`); never references `$`. Executable (`100755`, hooks-executable rule).
- Behavior: any spelling of `claude-code-guide` (lowercased, separator runs collapsed to `-`) runs as `claude-code-knowledge:claude-code-expert`, other arguments kept. Loop-safe: the target is not a guide. Main loop and subagents alike.
- Fail-open: no `.catch`, so a throwing hook is skipped and the guide runs un-rerouted, as the former `mcp_tool` hook did when its server was down.
- No permission override: the former hook's `permissionDecision: "allow"` only carried its `updatedInput`. A mods rewrite needs none, and Agent calls raise no prompt in `default` mode (live-verified on 2.1.302).
- `.claude-plugin/types/` is engine-written and gitignored.
- `claude plugin validate` reports one pre-existing error: the plugin name is reserved under the CLI's third-party naming rule. The module itself validates (`tool.call{tool=Agent|Task}`), and `--plugin-dir` still loads it (`plugin.register ... admitted`).

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
# CI: reroute.mjs (test/claude-code-knowledge/*.test.mjs)
pnpm run test:unit
# local only (CI has no claude CLI): hook wiring, tests/claude-code-knowledge.test.ts
claude plugin test plugins/claude-code-knowledge
```

The suite is structural: it checks the plugin manifest, the cc-reference skill shape, the reference files under `references/` (incl. the `references/` layout convention + `skill-folder-structure.md`), the expert agent, the reroute mod's files and wiring, and that the update-cc-references maintenance skill is present but user-only. Its `claude plugin validate`/`test` cases run only when `claude` is on `PATH`.

## rtk does not apply

- The fetch-variant components (`claude-code-expert`, `cc-author-planner`, `cc-reviewer`, `cc-reference`) fall back to WebFetch — a problem domain `rtk` (a shell-command proxy) has no role in.
- The shell-variant skills (`cc-review`, `memory-audit`) have no rtk-optimizable command: `memory-audit`'s `find` call was tested directly and `rtk find` refuses it outright for its compound predicates (`-o`, `-not`).
