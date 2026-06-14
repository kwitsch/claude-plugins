# claude-code-knowledge — dev notes

## Boundary rule

The plugin ships exactly one component: `plugins/claude-code-knowledge/skills/cc-reference/`.

Maintenance tooling lives at `.claude/skills/update-cc-references/` (repo root) and does NOT ship — the plugin loader reads only the plugin's own `skills/` directory. Do not add agents, hooks, or bin scripts to this plugin without a deliberate design decision.

## Reference-file authoring style

The four files under `skills/cc-reference/` are harness reference files, not prose documentation. Follow these conventions:

- Directives not prose: state rules as imperatives or tables, not explanatory paragraphs.
- Tables for field references: frontmatter keys, schema fields, and option enumerations all go in markdown tables.
- `verified:` date in each file's header: keep it accurate when editing.
- Forward slashes for paths; no backslashes.
- No time-sensitive phrasing: instead of "new in X.Y", use a version-gate note (`version >= X.Y:` prefix on the row).
- Body under 500 lines per file.

## Versioning

Version lives ONLY in `.claude-plugin/plugin.json`. Rules:

- Minor-bump on any reference-file refresh (handled automatically by `update-cc-references`).
- Do NOT put a `version` field in the marketplace.json entry for this plugin.
- Do NOT create git tags manually — CI (`tag-on-version-bump.yml`) tags after merge.

## Tests

```bash
BATS_LIB_PATH=/usr/lib/bats bats test/claude-code-knowledge/
```

The suite is structural: it checks the plugin manifest, the cc-reference skill shape, the four reference files, and that the update-cc-references maintenance skill is present but user-only.

## Expert agent + reroute hook

- `agents/claude-code-expert.md` — read-only agent (model haiku; tools `Skill, Read, Grep, WebFetch, WebSearch`; no write tools). Its sole knowledge source is the `cc-reference` skill; it must never answer from training memory.
- `hooks/reroute-guide.mjs` + `hooks/hooks.json` — `PreToolUse` (matcher `Agent|Task`) hook that rewrites `tool_input.subagent_type` from `claude-code-guide` to `claude-code-knowledge:claude-code-expert` via `permissionDecision:"allow"` + `updatedInput`. Fail-open (exit 0, no output) on non-match or bad input; never exits 2; loop-safe.
- These keep the plugin's boundary: still no MCP server, no runtime doc cache. The agent reaches live docs only through cc-reference's WebFetch fallback.
