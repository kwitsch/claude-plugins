# claude-code-knowledge — dev notes

## Boundary rule

The plugin ships these components:
- `skills/cc-reference/` — the lookup skill + bundled reference files.
- `skills/cc-review/` — the inline review orchestrator (dispatches `cc-reviewer`, gates fixes through AskUserQuestion).
- `agents/claude-code-expert.md` — the read-only Q&A expert (reroute target).
- `agents/cc-reviewer.md` — the read-only parameterized review worker dispatched by `cc-review`.
- `hooks/hooks.json` + `mcp/server.mjs` + `.mcp.json` — the `claude-code-guide` reroute hook backend.

Maintenance tooling lives at `.claude/skills/update-cc-references/` (repo root) and does NOT ship — the plugin loader reads only the plugin's own `skills/` directory. Adding further components requires a deliberate design decision.

## Reference-file authoring style

The reference files under `skills/cc-reference/references/` are harness reference files, not prose documentation. Follow these conventions:

- Directives not prose: state rules as imperatives or tables, not explanatory paragraphs.
- Tables for field references: frontmatter keys, schema fields, and option enumerations all go in markdown tables.
- `verified:` date in each maintained file's header: keep it accurate when editing. (`skill-folder-structure.md` is a static convention doc — no verified date, not refreshed by `update-cc-references`.)
- Forward slashes for paths; no backslashes.
- No time-sensitive phrasing: instead of "new in X.Y", use a version-gate note (`version >= X.Y:` prefix on the row).
- Body under 500 lines per file.
- Layout convention: a single bundled reference file sits next to `SKILL.md`; **≥2 reference files live in the `references/` subfolder** (documented in `references/skill-folder-structure.md`).

## Versioning

Version lives ONLY in `.claude-plugin/plugin.json`. Rules:

- Patch-bump on any reference-file refresh (handled automatically by `update-cc-references`, which also stamps the ingestion date into the plugin `description`).
- Do NOT put a `version` field in the marketplace.json entry for this plugin.
- Do NOT create git tags manually — CI (`tag-on-version-bump.yml`) tags after merge.

## Tests

```bash
BATS_LIB_PATH=/usr/lib/bats bats test/claude-code-knowledge/
```

The suite is structural: it checks the plugin manifest, the cc-reference skill shape, the reference files under `references/` (incl. the `references/` layout convention + `skill-folder-structure.md`), the expert agent, the mcp_tool reroute server, and that the update-cc-references maintenance skill is present but user-only.

## Expert agent + reroute hook

- `agents/claude-code-expert.md` — read-only agent (model haiku; tools `Skill, Read, Grep, WebFetch, WebSearch`; no write tools). Its sole knowledge source is the `cc-reference` skill; it must never answer from training memory.
- `hooks/hooks.json` + `mcp/server.mjs` + `.mcp.json` — `PreToolUse` (matcher `Agent|Task`) **`mcp_tool`** hook (server `plugin:claude-code-knowledge:claude-code-knowledge-hooks` — the runtime-namespaced name from `claude mcp list`, NOT the bare `.mcp.json` key, else "MCP server not connected"; tool `reroute_guide`) that rewrites `tool_input.subagent_type` from `claude-code-guide` to `claude-code-knowledge:claude-code-expert` via `permissionDecision:"allow"` + `updatedInput` (returned as the tool's text output → parsed as the hook decision). No-op for any other subagent; fail-open if the server is unconnected (the guide just runs un-rerouted); loop-safe. `mcp_tool` is the repo-preferred type for non-blocking mid-loop PreToolUse hooks (`.claude/rules/hooks-mcp-server.md`). The server is self-contained, zero-dep, `chmod +x` (bun-preferred, node fallback).
- Boundary: the only MCP server is this hook backend; there is no runtime doc cache. The agent reaches live docs only through cc-reference's WebFetch fallback.
