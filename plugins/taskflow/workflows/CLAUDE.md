# CLAUDE.md — taskflow/workflows

`*.workflow.js` files — `changes-review.workflow.js` and build-task's seven `build-task-*.workflow.js` scripts here — are excluded from the repo's `eslint.config.mjs` (root `ignores`, `**/*.workflow.js`): Workflow-tool scripts run inside an implicit async wrapper, so top-level `await`/`return` are valid there but not parseable as a standalone ES module.

## Model assignment

No model tier is pinned: every role floats on its family alias (`haiku`/`sonnet`/`opus`/`fable`, each resolving to the newest model in that family). Pinned IDs caused problems in practice and were removed across the board (`sonnet`/`haiku` were always bare). Do not reintroduce a pinned ID; the bats suite sweeps the whole plugin for one.

`haiku` is the default tier: every fixed role in a script's `MODELS` and the per-task implementer/fixer run on it. Off the default tier: the recall/judgment-critical roles on `sonnet` (`MODELS.finder`, `verifier`, `applier`, `ponytailReviewer` in `review.workflow.js` and `changes-review.workflow.js`, `MODELS.ciFixer` in `ship.workflow.js`), the per-task reviewer for `complex` tasks (`reviewModel()` in `implement.workflow.js` picks `sonnet` for them), the design phase (the design reviewer in `design.workflow.js` and the spec writer and spec reviewer in `spec.workflow.js` stay on `sonnet`; the `scout`, explorers, memory recall and `scribe` in `explore.workflow.js` run on `haiku`), the plan phase (`MODELS.planChecker` in `plan.workflow.js` stays on `sonnet`), and the fixed `opus` roles listed below (`MODELS.synthesizer`, `implModel()` for `complex` tasks). The designer and planner pick their model per run, as below.

The two highest-judgment authoring roles pick their model per run from the `SIZE` arg (build-task sizes the task once after Explore — jev-api `score`, or its own reasoning). Both use the same table — `S → sonnet`, `M → opus`, `L → opus`, `XL → fable`, unset or unknown → `opus` — and the same fallbacks: a `fable` dispatch that throws falls back to `opus` for the rest of the run, and a `null` result on `fable` is retried on `opus`.

- **designer** (`workflows/build-task-design.workflow.js`): `DESIGN_MODEL` / `designerModel()` resolve `DESIGNER_MODEL`, passed to the designer's `agent()` call.
- **planner** (`workflows/build-task-plan.workflow.js`): `PLAN_MODEL` / `plannerModel()` resolve `PLANNER_MODEL`, used in all three planner dispatches.

Fixed bare `opus`, not size-driven:

- `MODELS.synthesizer` in `workflows/build-task-review.workflow.js` and `changes-review.workflow.js`.
- `implModel()` in `implement.workflow.js` — `opus` for `complexity === "complex"` tasks, `haiku` otherwise (the per-task fixer reuses the implementer's model).

The agents' frontmatter `model` is only a default; the explicit `agent()` `model` option always wins: `DESIGNER_MODEL`, `PLANNER_MODEL`, or the script's `MODELS` entry (merger, pr-author, shipper and ci-monitor on `haiku`, ci-fixer on `sonnet`). The `MODELS` object at the top of each script is the single place to change a fixed assignment.

The review depth is not a model choice but follows the same size: build-task maps `SIZE` to `LEVEL` (`S`/`M` → `high`, `L`/`XL` → `max`) and passes it to `review.workflow.js`; no script derives it from the plan.

## `NO_NARRATION` on inline prompts

- Eleven roles are dispatched through a plugin `agentType` (`review-finder`, `review-verifier`, `fix-applier`, plus the eight build-task roles designer, design-reviewer, planner, worktree-merger, pr-author, shipper, ci-monitor, ci-fixer); their `agents/*.md` system prompt carries the rule. Every other prompt in every script is inline and prefixed with `NO_NARRATION`: the scope-gathering, synthesizer and lean-pass agents of both review scripts, and the remaining agents of the other build-task scripts — scout, explorers, memory recall, scribe, spec writer, spec reviewer, plan checker, plan loader, per-task implementer/reviewer/fixer, result-file scribe, ship's result-files check. `build-task-design.workflow.js` has no inline prompt and no `NO_NARRATION` constant.
- Role agents are named only by `agentType` (their model comes from the script's `model` option, which overrides the agent frontmatter); no prompt of theirs points at a role file.
- Each script defines `const NO_NARRATION = "…"` (wording identical in every script and to the rule in `agents/*.md`) near the top. Add the same prefix to any new inline (non-`agentType`) prompt in any workflow script.
- The built-in `agentType: "Explore"` path (`explorerPrompt` in `explore.workflow.js`) carries the rule only in the per-call prompt text: its system prompt is foreign to this plugin.

## `design.workflow.js` designer prompt

The designer prompt in `workflows/build-task-design.workflow.js` states explicitly that `keypoints` and `openQuestions` are separate structured-output fields — `openQuestions` must never be embedded as text/tags inside `keypoints` (a model that conflates the two fails `StructuredOutput` schema validation repeatedly, or worse, emits schema-valid placeholder junk that then sails into the pipeline undetected). `runDesigner`'s retry (`hasContaminatedKeypoints`) also retries on a schema-valid result whose `keypoints` string still contains contamination markers (`<openQuestions`, `</invoke`), not just on a `null` result — see `agents/designer.md` for the parallel role-file statement of this same rule.

## Lean (ponytail) review — embedded prose, report-only

Both `workflows/build-task-review.workflow.js`'s Review phase and the
standalone `changes-review.workflow.js` end with a separate, report-only lean pass
(`PONYTAIL_REVIEW_SCHEMA` → `ponytailReview`) that reuses the already-built
`SCOPE_BLOCK`/`DIFF_CMD` and reports over-engineering ONLY. `changes-review`'s
copy is identical except it drops the USER-APPROVED-spec paragraph — a bare
audit has no spec to reference. Its raw claims are independently verified
through the same `verifyGroups` group-verifier step as every other review
candidate, and any claim at the same location as a surviving combined
correctness+cleanup finding is dropped (dedup) so the report never shows an
unvetted claim next to — or contradicting — a verified one. Still never
routed to fix application, never escalated.
`agents/designer.md` and
`agents/design-reviewer.md` embed ponytail's reuse
ladder as static prose: ponytail is an external, non-allowlisted-marketplace
plugin, so there is deliberately no runtime `Skill`/`dependencies` reference
to it (the embedded phrasing can drift from upstream — that is the accepted,
required trade-off).

## Result files and the scribe

`implement.workflow.js` and `review.workflow.js` each end by writing one JSON
result file (`IMPLEMENT_PATH`, `REVIEW_PATH`) through an identical `persist()`
helper (only its `phase` label differs): a `haiku` scribe writes the text with
a Bash heredoc (`TASKFLOW_JSON_EOF`, never the Write or Edit tool — the
universal-format hook would reformat it), then reports `wc -c`; the script
accepts the expected UTF-8 byte count or that count plus one (the heredoc's
trailing newline), with one retry. A failed write is an explicit
`status: "error"` whose return still carries what the skill needs (Implement:
`tasks`/`waves`/`results`/`minorFindings`; Review: `applied`/`escalatedToUser`).
The explore scribe is the older variant of the same check and writes with the
Write tool.

## Conditional graphmind path (build-task explorers, delivery planner)

Both `workflows/build-task-explore.workflow.js` and
`workflows/build-task-plan.workflow.js` derive a module-level `USE_GRAPHMIND`
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
or `none`). The design and spec scripts never use graphmind. Delivery: a
conditional paragraph in `plannerPrompt` only (the planner prompt is inline
and carries `NO_NARRATION`); the implement, review and ship scripts take no
graphmind args.
**Availability detection lives once in `build-task/SKILL.md`** (a `ToolSearch`
`select:mcp__graphmind__gm_search` probe + `graphmind which` + `git rev-parse
--show-toplevel`, threaded in via `args`, per `.claude/rules/script-authoring.md`
§4 "Inject before query") — the workflow scripts never self-probe and never
re-query per subsystem. The scout pass stays on `agentType: "Explore"`
regardless: it is a coarse survey (1-4 subsystem names), not code-location
finding. Review finders/verifiers do not use graphmind (their agents are
tool-restricted to Read/Grep/Glob/Bash).
