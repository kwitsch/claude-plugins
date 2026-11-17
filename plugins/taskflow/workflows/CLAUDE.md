# CLAUDE.md — taskflow/workflows

`*.workflow.js` files — `workflows/*.workflow.js` here and build-task's design-pipeline scripts in `skills/build-task/references/` — are excluded from the repo's `eslint.config.mjs` (root `ignores`, `**/*.workflow.js`): Workflow-tool scripts run inside an implicit async wrapper, so top-level `await`/`return` are valid there but not parseable as a standalone ES module.

## Model assignment

No model tier is pinned: every role floats on its family alias (`haiku`/`sonnet`/`opus`/`fable`, each resolving to the newest model in that family). Pinned IDs caused problems in practice and were removed across the board (`sonnet`/`haiku` were always bare). Do not reintroduce a pinned ID; the bats suite sweeps the whole plugin for one.

`haiku` is the default tier: every fixed role in `MODELS` and the per-task implementer/fixer run on it, apart from the recall/judgment-critical roles on `sonnet` (`MODELS.finder`, `verifier`, `applier`, `ciFixer`, `ponytailReviewer`), the per-task reviewer for `complex` tasks (`reviewModel()` picks `sonnet` for them), the design phase (build-task's design-pipeline scripts in `skills/build-task/references/`: the design reviewer in `design.workflow.js` and the spec writer and spec reviewer in `spec.workflow.js` stay on `sonnet`; the `scout`, explorers, memory recall and `scribe` in `explore.workflow.js` run on `haiku`), the plan phase (`MODELS.planChecker` stays on `sonnet`), and the fixed `opus` roles listed below (`MODELS.synthesizer`, `implModel()` for `complex` tasks). The designer and planner pick their model per run, as below.

The two highest-judgment authoring roles pick their model per run (the resolver default on any miss is `opus`; a `fable` dispatch that throws falls back to `opus` for the rest of the run):

- **designer** (`skills/build-task/references/design.workflow.js`): build-task sizes the task after Explore (jev-api `score`, or its own reasoning) and passes `SIZE`; `DESIGN_MODEL` / `designerModel()` resolve `DESIGNER_MODEL` (`S → sonnet`, `M → opus`, `L → opus`, `XL → fable`), passed to the designer's `agent()` call.
- **planner** (`spec-driven-delivery.workflow.js`): a small haiku spec classifier (`CLASSIFY_SCHEMA`, `agentType: "Explore"`) runs before `makePlan()`; `PLAN_MODEL` / `plannerModel()` resolve `PLANNER_MODEL` (`simple → sonnet`, `complex → opus`, `hardest → fable`), used in all three planner dispatches.

Fixed bare `opus`, not classifier-driven:

- `MODELS.synthesizer` in `spec-driven-delivery.workflow.js` and `changes-review.workflow.js`.
- `implModel()` — `opus` for `complexity === "complex"` tasks, `haiku` otherwise (the per-task fixer reuses the implementer's model).

Agent frontmatter `model:` (`agents/planner.md`) is the bare `opus` default for a direct out-of-workflow invocation; the workflow's per-run `agent()` `model` option overrides it (same precedence as `implModel(t)`). The designer role file has no frontmatter: its model always comes from `DESIGNER_MODEL`. The `MODELS` object at the top of each workflow script is the single place to change a fixed assignment.

## `NO_NARRATION` on inline prompts

- Several roles are dispatched with a fully inline prompt and no `agentType`, so no `agents/*.md` system prompt backs them: the plan checker, per-task implementer/reviewer/fixer, the scope-gathering and synthesizer agents of both review phases, and `changes-review`'s lean pass.
- build-task's design-pipeline scripts (`skills/build-task/references/*.workflow.js`) dispatch every agent inline — scout, explorers, memory recall, scribe, designer, design reviewer, spec writer, spec reviewer — and prefix every prompt with `NO_NARRATION`. The designer and design reviewer additionally read their role file (`designer.md` / `design-reviewer.md` in the same directory) by the absolute path built from the `REFS_DIR` arg.
- Each script defines `const NO_NARRATION = "…"` (wording identical in every script and to the rule in `agents/*.md`) near the top, and every inline prompt is prefixed with it. Add the same prefix to any new inline (non-`agentType`) prompt in any workflow script.
- The built-in `agentType: "Explore"` path (`explorerPrompt`) carries the rule only in the per-call prompt text: its system prompt is foreign to this plugin.

## `design.workflow.js` designer prompt

The designer prompt in `skills/build-task/references/design.workflow.js` states explicitly that `keypoints` and `openQuestions` are separate structured-output fields — `openQuestions` must never be embedded as text/tags inside `keypoints` (a model that conflates the two fails `StructuredOutput` schema validation repeatedly, or worse, emits schema-valid placeholder junk that then sails into the pipeline undetected). `runDesigner`'s retry (`hasContaminatedKeypoints`) also retries on a schema-valid result whose `keypoints` string still contains contamination markers (`<openQuestions`, `</invoke`), not just on a `null` result — see `skills/build-task/references/designer.md` for the parallel role-file statement of this same rule.

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
routed to fix application, never escalated.
`skills/build-task/references/designer.md` and
`skills/build-task/references/design-reviewer.md` embed ponytail's reuse
ladder as static prose: ponytail is an external, non-allowlisted-marketplace
plugin, so there is deliberately no runtime `Skill`/`dependencies` reference
to it (the embedded phrasing can drift from upstream — that is the accepted,
required trade-off).

## Conditional graphmind path (build-task explorers, delivery planner)

Both `skills/build-task/references/explore.workflow.js` and
`spec-driven-delivery.workflow.js` derive a module-level `USE_GRAPHMIND`
boolean from the `GRAPHMIND_AVAILABLE` + `REPO_PATH` args (a set flag with no
absolute `REPO_PATH` fails loud with a `stage: 'args'` error before any agent
runs). The explore script's per-subsystem explorers run one of two ways: when
true, a `NO_NARRATION`-prefixed inline `graphmindExplorePrompt` (no
`agentType`, default subagent) that locates code via
`gm_search`/`gm_outline`/`gm_deps`/`gm_fn` with `project` = `REPO_PATH`, falls
back to Read/Grep/Glob, and runs `git log` via Bash; when false, the built-in
`agentType: "Explore"` path via `explorerPrompt`. Both branches return the same
`EXPLORE_SCHEMA` `{report}`, so the `sections` aggregation and the
scribe-written exploration file are untouched. Project memory is NOT searched
per explorer: when true, one extra `graphmindRecallPrompt` agent runs
`gm_memory_search` once after the explorers and its result is appended as a
separate "Recorded project knowledge" section (skipped when it returns nothing
or `none`). The design and spec scripts never use graphmind (`GRAPHMIND_AVAILABLE`
and `REPO_PATH` are Explore-only). Delivery: a conditional paragraph in
`plannerPrompt` only (the planner is an `agentType` prompt, so it carries no
`NO_NARRATION`).
**Availability detection lives once in `build-task/SKILL.md`** (a `ToolSearch`
`select:mcp__graphmind__gm_search` probe + `graphmind which` + `git rev-parse
--show-toplevel`, threaded in via `args`, per `.claude/rules/script-authoring.md`
§4 "Inject before query") — the workflow scripts never self-probe and never
re-query per subsystem. The scout pass stays on `agentType: "Explore"`
regardless: it is a coarse survey (1-4 subsystem names), not code-location
finding. Review finders/verifiers do not use graphmind (their agents are
tool-restricted to Read/Grep/Glob/Bash).
