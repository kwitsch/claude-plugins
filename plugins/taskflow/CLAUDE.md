# taskflow — dev notes

## Boundary rule

The plugin ships these components:

- `skills/build-task/` — the inline orchestrator skill. Branch handling, `AskUserQuestion` checkpoints, invokes the two workflows below by name, applies escalated review fixes.
- `workflows/design-to-spec.workflow.js` + `workflows/spec-driven-delivery.workflow.js` — the two dynamic Workflow-tool scripts that do the heavy lifting. Auto-discovered from the plugin-root `workflows/` directory (no manifest field needed); run namespaced as `/taskflow:design-to-spec` / `/taskflow:spec-driven-delivery`.
- `agents/*.md` — 11 static role prompts (`planner`, `designer`, `design-reviewer`, `review-finder`, `review-verifier`, `worktree-merger`, `fix-applier`, `pr-author`, `shipper`, `ci-monitor`, `ci-fixer`), dispatched by the workflows via `agentType: 'taskflow:<name>'`. INTERNAL — each agent's own description says not to delegate to it directly.

Renaming the plugin requires updating the `AGENTS` map's namespace prefix in both workflow scripts to match.

## `workflows/` — a plugin component undocumented in `plugins/CLAUDE.md`

This is the first plugin in the repo to ship a `workflows/` directory. It is
a real, documented Claude Code plugin component (auto-discovered like
`skills/`/`agents/`; see the curated `claude-code-plugins-reference.md`) —
`plugins/CLAUDE.md`'s structure table just predates it. If you touch that
table, add a `workflows/` row rather than treating this plugin's use of the
directory as nonstandard.

## userConfig

No `userConfig` in `plugin.json` — deliberate, see the `taskflow` entry in
`.claude/rules/plugin-userconfig.md`'s no-toggle exceptions: the plugin ships
one skill that only runs when explicitly invoked, so there is no
automatic/background behavior for a toggle to suppress.

## Model pinning

Some roles use a bare alias (`sonnet`/`haiku`/`opus` — floats to the newest
model in that family); others pin an exact model ID (e.g. `claude-opus-4-8`,
`claude-sonnet-4-6`) to keep behavior stable across model upgrades for
high-leverage or high-volume roles. Both are legitimate current model IDs —
verified against live Anthropic docs during integration (2026-08-07), not a
naming-scheme guess. The `MODELS` object at the top of each workflow script
is the single place to change an assignment; agent frontmatter `model:`
fields must be kept in sync with the corresponding workflow's default when an
agent is also invoked directly outside its workflow's normal path.

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/taskflow/
```

The suite is structural: plugin manifest invariants (no `userConfig`), the
`build-task` skill frontmatter + reference files, presence and frontmatter of
all 11 agents (including the least-privilege `tools:` allowlist on the 4
read-only-declared agents: `design-reviewer`, `review-finder`,
`review-verifier`, `ci-monitor`), and both `workflows/*.workflow.js` files'
`export const meta` shape.

## Linting

`workflows/*.workflow.js` are excluded from the repo's `eslint.config.mjs`
(root `ignores`) — Workflow-tool scripts run inside an implicit async
wrapper, so top-level `await`/`return` are valid there but not parseable as a
standalone ES module.
