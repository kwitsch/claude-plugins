# taskflow — dev notes

## Boundary rule

The plugin ships these components:

- `skills/build-task/` — the inline orchestrator skill. Branch handling, `AskUserQuestion` checkpoints, invokes the two workflows below by name, applies escalated review fixes.
- `workflows/design-to-spec.workflow.js` + `workflows/spec-driven-delivery.workflow.js` — the two dynamic Workflow-tool scripts that do the heavy lifting. Auto-discovered from the plugin-root `workflows/` directory (no manifest field needed); run namespaced as `/taskflow:design-to-spec` / `/taskflow:spec-driven-delivery`.
- `agents/*.md` — 11 static role prompts (`planner`, `designer`, `design-reviewer`, `review-finder`, `review-verifier`, `worktree-merger`, `fix-applier`, `pr-author`, `shipper`, `ci-monitor`, `ci-fixer`), dispatched by the workflows via `agentType: 'taskflow:<name>'`. INTERNAL — each agent's own description says not to delegate to it directly.

Renaming the plugin requires updating the `AGENTS` map's namespace prefix in both workflow scripts to match.

## `workflows/` is a documented plugin component

This is the first plugin in the repo to ship a `workflows/` directory. It is
a real, documented Claude Code plugin component (auto-discovered like
`skills/`/`agents/`; see the curated `claude-code-plugins-reference.md`) —
`plugins/CLAUDE.md`'s structure table just predated it and now carries a
`workflows/` row (added alongside this plugin). Treat this plugin's use of
the directory as the standard, not an exception.

## userConfig

No `userConfig` in `plugin.json` — deliberate, see the `taskflow` entry in
`.claude/rules/plugin-userconfig.md`'s no-toggle exceptions: the plugin ships
one skill that only runs when explicitly invoked, so there is no
automatic/background behavior for a toggle to suppress.

## Model assignment

Every role uses a bare alias (`sonnet`/`haiku`/`opus` — floats to the newest
model in that family); no role pins an exact model ID. Pinned IDs caused
problems in practice and were removed in favor of aliases across the board.
The `MODELS` object at the top of each workflow script is the single place to
change an assignment; agent frontmatter `model:` fields must be kept in sync
with the corresponding workflow's default when an agent is also invoked
directly outside its workflow's normal path.

## Generated pipeline artifacts are always English

The draft/spec/plan files the designer, spec writer, and planner write
(`draft-<slug>.md`, `spec-<slug>.md`, `plan-<slug>.md`, per `SKILL.md`'s
Session temp files section) are always written in English, regardless of
`$task_description`'s language — enforced by an explicit instruction in
`agents/designer.md`, `agents/planner.md`, and the inline spec-writer prompt
in `workflows/design-to-spec.workflow.js` (there is no dedicated agent file
for the spec writer). These files are read only by other agents in the
pipeline, never shown to the user directly, so a consistent working language
matters more than mirroring the request's language. This does not extend to
the final human-facing report the orchestrator gives the user (`SKILL.md`
step 5) or to reviewer finding text, neither of which are addressed here.

## Resuming inside an existing worktree/PR

`SKILL.md` step 1 only cuts a new `feature/<slug>` branch when the current
branch IS the base branch; otherwise it stays on the current branch,
including when build-task is invoked inside an already-checked-out worktree
that has an open PR/MR for its branch — Ship's create-or-update (`shipper.md`,
via `gh pr view <branch>`) then updates that PR/MR rather than opening a new
one. `fix-applier.md` and `worktree-merger.md` correspondingly check "is the
named work/merge-target branch checked out here" (`git branch
--show-current`), never "is this the primary repo root, not a worktree" —
the latter would incorrectly abort (fix-applier) or silently merge into the
wrong branch (worktree-merger) in exactly this resumed-worktree case.
Verified 2026-08-07: a non-isolated `agent()`/Agent-tool dispatch from a
worktree-isolated session correctly resolves `pwd` and `git
rev-parse --show-toplevel` to that worktree, not the primary repo root — so
no explicit checkout-path threading is needed for this to work. (A prior,
unrelated finding about _bridge_/remote-control sessions defaulting subagent
cwd to the primary root does not apply to this dispatch path — don't conflate
the two.)

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/taskflow/
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
