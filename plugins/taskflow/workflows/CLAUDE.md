# CLAUDE.md — taskflow/workflows

`workflows/*.workflow.js` are excluded from the repo's `eslint.config.mjs` (root `ignores`) — Workflow-tool scripts run inside an implicit async wrapper, so top-level `await`/`return` are valid there but not parseable as a standalone ES module.

## `design-to-spec.workflow.js` designer prompt

The designer prompt states explicitly that `keypoints` and `openQuestions` are separate structured-output fields — `openQuestions` must never be embedded as text/tags inside `keypoints` (a model that conflates the two fails `StructuredOutput` schema validation repeatedly, or worse, emits schema-valid placeholder junk that then sails into the pipeline undetected). `runDesigner`'s retry (`hasContaminatedKeypoints`) also retries on a schema-valid result whose `keypoints` string still contains contamination markers (`<openQuestions`, `</invoke`), not just on a `null` result — see `agents/designer.md` for the parallel agent-side statement of this same rule.
