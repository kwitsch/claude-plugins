# Implementing (workflow-driven development)

Execute the revised plan task-by-task: fresh worker per task, per-task review,
deterministic control flow. The loop's structure lives in an orchestration script
(or, in the fallback, in this fixed procedure) — not in ad-hoc judgment.

## Inputs

- `planPath` — absolute plan temp path.
- `tasks` — the plan's task list parsed as `[{id, title}]` (task number + heading).
- `constraints` — the plan's `## Global Constraints` section, verbatim.

## Per-task loop (identical in both engines)

1. Dispatch the **implementer** with (planPath, task id, constraints).
2. Reconcile its completion (gate below), then dispatch the **reviewer** with the
   task's commit range and the implementer's report.
3. Verdict `approved: false` with `critical`/`important` findings → dispatch the
   **fixer** once with exactly those findings, then one re-review. Still failing →
   stop the loop and surface the task id, findings, and last worker output.
4. `minor` findings: record them (task ledger / progress notes); they are presented
   again at the PR stage, never silently dropped.
5. Next task. Tasks run strictly in order — plan tasks depend on their predecessors.

## Engine selection

Probe once: `ToolSearch(query: "select:Workflow")`.
- **Available → Workflow engine (canonical).** This reference instructing the call
  is the documented opt-in for using it.
- **Absent → Agent engine.**
- Workflow rejects the script (meta/API validation error) → do not fight API drift;
  switch to the Agent engine.

## Workflow engine

Invoke the Workflow tool with `args = {planPath, tasks, constraints}` and this
script (adapt only the three prompt templates if the plan demands extra context):

```js
export const meta = {
  name: 'fresh-work-implement',
  description: 'Implement plan tasks sequentially with per-task review',
  phases: [{ title: 'Implement' }],
}
// args: { planPath: string, constraints: string, tasks: [{ id: string, title: string }] }
const VERDICT = {
  type: 'object',
  required: ['approved', 'findings'],
  properties: {
    approved: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'description', 'file'],
        properties: {
          severity: { enum: ['critical', 'important', 'minor'] },
          description: { type: 'string' },
          file: { type: 'string' },
        },
      },
    },
  },
}
const implementerPrompt = (t) => `You are the implementer for exactly one plan task.
Plan file: ${args.planPath} — Read it; execute ONLY task ${t.id} (${t.title}).
Global constraints (binding): ${args.constraints}
Work test-first: write the task's failing test, watch it fail, implement minimally,
watch it pass, run the task's verification commands. Commit the task as ONE commit
following the repo's commit conventions (no co-author trailers, no generated-with
footers). Touch nothing outside the task's scope.
Return: STATUS: done|blocked, the commit hash, test evidence (commands + output),
and any deviation from the plan.`
const reviewerPrompt = (t, implReport) => `You are a read-only reviewer for one plan task.
Plan file: ${args.planPath} — Read it; review ONLY task ${t.id} (${t.title}).
Implementer report: ${implReport}
Diff the task's commit(s) against their parent. Check spec compliance against the
task text and these global constraints, then correctness:
${args.constraints}
Do not re-run tests the implementer already ran — their report carries the evidence.
Return your verdict through the structured output schema.`
const fixerPrompt = (t, findings) => `You are the fixer for one reviewed plan task.
Plan file: ${args.planPath}, task ${t.id} (${t.title}).
Apply exactly these findings — nothing else — then commit (repo conventions, no
co-author trailers): ${JSON.stringify(findings)}
Return: STATUS: done|blocked, commit hash, what changed.`
const results = []
for (const t of args.tasks) {
  let impl = await agent(implementerPrompt(t), { label: `task:${t.id}`, phase: 'Implement' })
  if (impl === null) impl = await agent(implementerPrompt(t), { label: `task:${t.id}:retry`, phase: 'Implement' })
  if (impl === null) {
    results.push({ id: t.id, status: 'failed', reason: 'implementer returned null twice' })
    break
  }
  let review = await agent(reviewerPrompt(t, impl), { label: `review:${t.id}`, phase: 'Implement', schema: VERDICT })
  if (review === null) review = await agent(reviewerPrompt(t, impl), { label: `review:${t.id}:retry`, phase: 'Implement', schema: VERDICT })
  if (review && !review.approved) {
    const blocking = review.findings.filter((f) => f.severity !== 'minor')
    if (blocking.length) {
      await agent(fixerPrompt(t, blocking), { label: `fix:${t.id}`, phase: 'Implement' })
      review = await agent(reviewerPrompt(t, 'Post-fix re-review; diff the fix commit too.'), {
        label: `re-review:${t.id}`,
        phase: 'Implement',
        schema: VERDICT,
      })
    }
  }
  const blockingLeft = !review || (!review.approved && review.findings.some((f) => f.severity !== 'minor'))
  if (blockingLeft) {
    results.push({ id: t.id, status: 'failed', review })
    break
  }
  results.push({ id: t.id, status: 'done', minor: (review.findings || []).filter((f) => f.severity === 'minor') })
}
return results
```

Script-environment facts (cross-check against the live Workflow tool schema before
use — probe it once with `ToolSearch(query: "select:Workflow")` and inspect its
description): plain JavaScript (no TypeScript syntax); `agent(prompt, {label, phase,
schema})` returns the worker's text, or the schema-validated object when `schema` is
passed, or `null` when the worker dies; `Date.now()`, `Math.random()`, and argless
`new Date()` may not be available inside scripts — pass timestamps and ids in via
`args` instead.

After the workflow returns, read the results: any `status: 'failed'` entry → stop
and surface it; otherwise carry the collected `minor` findings forward to the PR
step.

## Agent engine (fallback)

Run the identical per-task loop yourself, dispatching each worker via the Agent tool
with the same three prompts (substitute the placeholders by hand). Strictly one
dispatch at a time; judge completion by the returned content, never by elapsed time.

> **Subagent reconciliation gate.** Track every async dispatch so you never advance
> on a partial batch and never miss a finish. Load the ledger tools once (deferred;
> resolve at depth 0, where this skill runs — a subagent-scoped probe falsely reports
> these absent, do NOT skip the ledger on that basis):
> `ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`
> (retry bare names). Only if the CRUD ledger tools (TaskCreate/TaskUpdate/TaskList)
> fail to load, use the prose-count fallback below — TaskStop loading alone is not
> sufficient to activate the ledger path.
> 1. On dispatch, `TaskCreate` one entry per worker actually dispatched
>    (`subject` = implementer/reviewer/fixer + task id, `metadata.dispatch_id` = its
>    Agent `task_id`), then `TaskUpdate` it to `in_progress`.
> 2. On each `<task-notification>`, match by `dispatch_id`, record the worker's
>    structured result, `TaskUpdate` → `completed` (soft-fail returns are terminal).
> 3. **Gate:** before dispatching the reviewer for a task, before dispatching the
>    fixer, and before starting the next task, `TaskList`; if the current worker's
>    entry is still `pending`/`in_progress`, do NOT advance — wait for its
>    `<task-notification>`.
> 4. Escape hatch only: if, when next awake, a still-`in_progress` entry is judged
>    genuinely stuck, `TaskStop` its `dispatch_id`, mark it terminal, record a
>    soft-failure, proceed. Never `TaskOutput` a dispatch_id (transcript overflow).
> Prose-count fallback (CRUD ledger tools genuinely absent): track the dispatched
> count explicitly; do not advance until that many structured results are in hand.

## Exit

All tasks `done` → return to the orchestrator (SKILL.md step 10, Review), which
does not consume the minor-findings list — carry it forward unchanged to step 11
(PR) for presentation. Any task failed → report it and stop; do not open a PR on
a half-implemented plan.
