# claude-code-knowledge — dev notes

## Boundary rule

The plugin ships these components:

- `skills/cc-reference/` — the lookup skill + bundled reference files.
- `skills/cc-review/` — the inline review orchestrator (dispatches `cc-reviewer`, gates fixes through AskUserQuestion).
- `skills/cc-author/` — the inline authoring orchestrator (dispatches `cc-author-planner`, writes the returned files, gates the optional `cc-review` hand-off).
- `skills/cc-memory/` — the inline project-memory audit-&-improve orchestrator (discovers every CLAUDE.md + `.claude/rules/*.md` file by default, reuses `cc-reviewer` with `component_type: memory`, grades them in a claude-md-improver-style report, surfaces leanness/scope-split recommendations, and gates fixes).
- `skills/cc-compress/` — compresses a markdown memory/instruction file into caveman-style prose in place to cut future load tokens, backing up the original to session-temp storage for rollback. Adaptation of upstream `caveman-compress` (JuliusBrussee/caveman); the compression call itself runs via a zero-dep `scripts/compress.mjs` shelling out to `claude --print --model sonnet`, never in-context.
- `skills/lsp-audit/` — audits a project's file extensions against its project-root `.lsp.json` and additively writes the missing LSP-server coverage a bundled catalog (`scripts/lsp-map.json`, 10 servers, resurrected from the deleted `init/lsp-repo-init` skill) recognizes; `--fix` auto-adds every catalog-resolvable entry, otherwise an `AskUserQuestion` multi-select picks which to add. All scan/diff/merge/safe-write logic lives in the zero-dep `scripts/audit-lsp.mjs` (additive-only, first-registered-wins, fail-closed on malformed JSON); the SKILL.md only orchestrates. Extensions with no catalog server are reported as manual to-dos, never guessed. Targets the project-root `.lsp.json` only. The catalog is operational data (like universal-lint's linter map), not duplicated `cc-reference` knowledge.
- `agents/claude-code-expert.md` — the read-only Q&A expert (reroute target).
- `agents/cc-reviewer.md` — the read-only parameterized review worker dispatched by `cc-review`.
- `agents/cc-author-planner.md` — the read-only authoring planner dispatched by `cc-author`; composes component content strictly from `cc-reference` and returns JSON, never writes.
- `hooks/hooks.json` + `mcp/server.mjs` + `.mcp.json` — the `claude-code-guide` reroute hook backend.

Maintenance tooling lives at `.claude/skills/update-cc-references/` (repo root) and does NOT ship — the plugin loader reads only the plugin's own `skills/` directory. Adding further components requires a deliberate design decision. Its contradiction-validation gate dispatches the repo-root `.claude/agents/cc-reference-validator.md` read-only agent (also not shipped).
The `cc-author`/`cc-memory`/`cc-author-planner` components were added by the
2026-06-17 authoring-extension design; they extend the lookup→review pair into a
lookup→author→review triad, all sourced from `cc-reference` (no duplicated
reference files).

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

## Expert agent + reroute hook

- `agents/claude-code-expert.md` — read-only agent (model haiku; tools `Skill, Read, Grep, WebFetch, WebSearch`; no write tools). Its sole knowledge source is the `cc-reference` skill; it must never answer from training memory.
- `hooks/hooks.json` + `mcp/server.mjs` + `.mcp.json` — `PreToolUse` (matcher `Agent|Task`) **`mcp_tool`** hook (server `plugin:claude-code-knowledge:claude-code-knowledge-hooks` — the runtime-namespaced name from `claude mcp list`, NOT the bare `.mcp.json` key, else "MCP server not connected"; tool `reroute_guide`) that rewrites `tool_input.subagent_type` from `claude-code-guide` to `claude-code-knowledge:claude-code-expert` via `permissionDecision:"allow"` + `updatedInput` (returned as the tool's text output → parsed as the hook decision). No-op for any other subagent; fail-open if the server is unconnected (the guide just runs un-rerouted); loop-safe. `mcp_tool` is the repo-preferred type for non-blocking mid-loop PreToolUse hooks (`.claude/rules/hooks-mcp-server.md`). The server is self-contained, zero-dep, `chmod +x` (bun-preferred, node fallback).
- Boundary: the only MCP server is this hook backend; there is no runtime doc cache. The agent reaches live docs only through cc-reference's WebFetch fallback.

context-mode was removed from this plugin 2026-07-06, completing the
repo-wide phase-out started in coding-toolbox (PR #112). `rtk` does not apply here: the 4 fetch-variant
files (`claude-code-expert`, `cc-author-planner`, `cc-reviewer`,
`cc-reference`) fall back to WebFetch, a different problem domain `rtk`
(a shell-command proxy) has no role in; the 2 shell-variant skills
(`cc-review`, `cc-memory`) have no rtk-optimizable command — `cc-memory`'s
`find` call was tested directly and `rtk find` refuses it outright for
using compound predicates (`-o`, `-not`).
