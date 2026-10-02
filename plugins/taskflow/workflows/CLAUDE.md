# CLAUDE.md — taskflow/workflows

`workflows/*.workflow.js` are excluded from the repo's `eslint.config.mjs` (root `ignores`) — Workflow-tool scripts run inside an implicit async wrapper, so top-level `await`/`return` are valid there but not parseable as a standalone ES module.

## Model assignment

No model tier is pinned: every role floats on its family alias (`haiku`/`sonnet`/`opus`/`fable`, each resolving to the newest model in that family). Pinned IDs caused problems in practice and were removed across the board (`sonnet`/`haiku` were always bare). Do not reintroduce a pinned ID; the bats suite sweeps the whole plugin for one.

The two highest-judgment authoring roles pick their model per run from a difficulty classification (`simple → sonnet`, `complex → opus`, `hardest → fable`; the resolver default on any miss is `opus`):

- **designer** (`design-to-spec.workflow.js`): the haiku `scout` returns a `difficulty` field (`SCOUT_SCHEMA`); `DESIGN_MODEL` / `designerModel()` resolve `DESIGNER_MODEL`, passed to the designer's `agent()` call.
- **planner** (`spec-driven-delivery.workflow.js`): a small haiku spec classifier (`CLASSIFY_SCHEMA`, `agentType: "Explore"`) runs before `makePlan()`; `PLAN_MODEL` / `plannerModel()` resolve `PLANNER_MODEL`, used in all three planner dispatches.

Fixed bare `opus`, not classifier-driven:

- `MODELS.synthesizer` in `spec-driven-delivery.workflow.js` and `changes-review.workflow.js`.
- `IMPL_MODEL.complex` — the per-task-complexity tier that `implModel()` / `fixModel()` resolve for `complexity === "complex"` tasks.

Agent frontmatter `model:` (`agents/designer.md`, `agents/planner.md`) is the bare `opus` default for a direct out-of-workflow invocation; the workflow's per-run `agent()` `model` option overrides it (same precedence as `implModel(t)`). The `MODELS` object at the top of each workflow script is the single place to change a fixed assignment.

## `NO_NARRATION` on inline prompts

- Several roles are dispatched with a fully inline prompt and no `agentType`, so no `agents/*.md` system prompt backs them: the scout, the exploration-tool explorer, spec writer and reviewer, plan checker, per-task implementer/reviewer/fixer, the scope-gathering and synthesizer agents of both review phases, and `changes-review`'s lean pass.
- Each script defines `const NO_NARRATION = "…"` (wording identical to the rule in `agents/*.md`) right after its `AGENTS` map, and every inline prompt is prefixed with it. Add the same prefix to any new inline (non-`agentType`) prompt in any workflow script.
- The built-in `agentType: "Explore"` path (`explorerPrompt`) carries the rule only in the per-call prompt text: its system prompt is foreign to this plugin.

## `design-to-spec.workflow.js` designer prompt

The designer prompt states explicitly that `keypoints` and `openQuestions` are separate structured-output fields — `openQuestions` must never be embedded as text/tags inside `keypoints` (a model that conflates the two fails `StructuredOutput` schema validation repeatedly, or worse, emits schema-valid placeholder junk that then sails into the pipeline undetected). `runDesigner`'s retry (`hasContaminatedKeypoints`) also retries on a schema-valid result whose `keypoints` string still contains contamination markers (`<openQuestions`, `</invoke`), not just on a `null` result — see `agents/designer.md` for the parallel agent-side statement of this same rule.

## Lean (ponytail) review — embedded prose, report-only

Both `spec-driven-delivery.workflow.js`'s Review phase and the standalone
`changes-review.workflow.js` end with a separate, report-only lean pass
(`PONYTAIL_REVIEW_SCHEMA` → `ponytailReview`) that reuses the already-built
`SCOPE_BLOCK`/`DIFF_CMD` and reports over-engineering ONLY. `changes-review`'s
copy is identical except it drops the USER-APPROVED-spec paragraph — a bare
audit has no spec to reference. Its raw claims are independently verified
through the same `verifyGroups` group-verifier step as every other review
candidate, and any claim at the same location as a surviving combined
correctness+cleanup finding is dropped (dedup) so the report never shows an
unvetted claim next to — or contradicting — a verified one. Still never
routed to fix application, never escalated. `agents/designer.md` and
`agents/design-reviewer.md` embed ponytail's reuse ladder as static prose:
ponytail is an external, non-allowlisted-marketplace plugin, so there is
deliberately no runtime `Skill`/`dependencies` reference to it (the embedded
phrasing can drift from upstream — that is the accepted, required trade-off).

## Conditional Explore path (design-to-spec)

`design-to-spec.workflow.js`'s per-subsystem explorers run one of two ways,
selected by the module-level `USE_EXPLORE_TOOL` boolean derived from the
`EXPLORE_TOOL_AVAILABLE` + `REPO_PATH` args: when true, a `NO_NARRATION`-prefixed
inline `exploreToolPrompt` (no `agentType`, default subagent) that calls the
`mcp__repo-explorer-mcp__explore_repository` MCP tool; when false, the
byte-identical built-in `agentType: "Explore"` path via `explorerPrompt`. Both
branches return the same `EXPLORE_SCHEMA` `{report}`, so the `sections`
aggregation, `explorationBlock`, and the designer prompt are untouched.
**Availability detection lives once in `build-task/SKILL.md`** (a `ToolSearch`
probe + `git rev-parse --show-toplevel`, threaded in via `args`, per
`.claude/rules/script-authoring.md` §4 "Inject before query") — the workflow
script never self-probes and never re-queries per subsystem. The scout pass
stays on `agentType: "Explore"` regardless: it is a coarse classify-only survey
(complexity + 1-4 subsystem names), not code-location finding.
