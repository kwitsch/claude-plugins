# Implementing (workflow-driven development)

Execute the revised plan task-by-task: fresh worker per task, per-task review,
deterministic control flow. The loop's structure lives in an orchestration script
(or, in the fallback, in this fixed procedure) — not in ad-hoc judgment.

## Inputs

- `planPath` — absolute plan temp path.
- `tasks` — read **verbatim** from the plan's `## Machine-readable tasks` JSON
  block, the `[{id, title, files, consumes, produces}]` list authored by the Plan phase
  (`references/planning.md`) in the same pass that wrote the prose tasks —
  **not re-parsed** from the prose task headings here. Each object's `files` are its
  `**Files:**` paths (Create/Modify/Test all count) and its `consumes`/`produces`
  are its `**Interfaces:**` name lists, already extracted at authoring time.
- `constraints` — the plan's `## Global Constraints` section, verbatim.
- `branchName` — the current work branch (`git branch --show-current`),
  captured once before Implement starts. Needed only for wave ≥2 dispatches:
  `isolation: 'worktree'` always branches its fresh worktree from the repo's
  **default** branch, not the caller's current HEAD — without this, a wave
  after the first would start from a tree missing every earlier wave's
  already-merged work.

## Parallelism analysis (before dispatch, deterministic — no agent call)

Plan tasks are numbered in dependency order already
(`references/planning.md`: "Consumes: exact names/signatures **from earlier
tasks**") — a task can only depend on a strictly earlier one, never a later
one. For tasks `1..N` in plan order:

```
depends_on[i] = { j < i : files[i] ∩ files[j] ≠ ∅ }
              ∪ { j < i : consumes[i] ∩ produces[j] ≠ ∅ }
              ∪ (every j < i — conservative fallback — if task i's Files or
                 Interfaces section is empty/unparseable, or a Consumes entry
                 names nothing in any earlier task's Produces)

wave[i] = 1                                        if depends_on[i] = ∅
wave[i] = 1 + max(wave[j] for j in depends_on[i])   otherwise
```

Group tasks by `wave[i]`; waves run in ascending order. Within a wave, every
task is mutually independent of its wave-mates: an edge only ever points from
a higher task id to a strictly lower one, so two same-wave tasks sharing an
edge would need different wave numbers — a contradiction. This holds only
because the backward-only-dependency invariant above holds; a plan that
violates it is already broken before this analysis runs. When in doubt
(unparseable or ambiguous `Files`/`Interfaces`), always take the conservative
branch — serialize, never guess a task is independent.

This is a mechanical algorithm, not a judgment call, so it is never
hand-computed and pasted in: the Workflow engine runs it as real code
(`computeWaves(tasks)` in the script below) over the `tasks` list read straight
from the plan's `## Machine-readable tasks` block; the Agent-engine fallback (no
script execution available) replicates the identical steps by hand over that same
block (read, not re-parsed from prose). The one genuine judgment call — deciding a
`Files`/`Interfaces` entry is too incomplete or ambiguous to trust — was already
made at authoring time (the Plan phase, `references/planning.md`), not inside the
leveling arithmetic itself; computeWaves' conservative branch still serializes any
task whose block entry has empty/absent `files` or a `consumes` naming nothing an
earlier task `produces`, exactly as before.

**Wave of size 1** (the common case for tightly-coupled plans) is exactly
today's flow: one worker, no isolation, direct commit to the shared branch —
unchanged from before this analysis existed. **Wave of size ≥2** takes the
isolated path below.

Announce each wave to the user before dispatching it, one line, e.g. "Wave
2/3: dispatching 3 tasks in parallel (ids 4, 5, 6)." — same principle as
this skill's own step-start reporting, applied one level in.

## Per-task loop — wave size 1 (identical in both engines, unchanged)

1. Dispatch the **implementer** with (planPath, task id, constraints).
2. Reconcile its completion (gate below), then dispatch the **reviewer** with the
   task's commit range and the implementer's report.
3. Verdict `approved: false` with `critical`/`important` findings → dispatch the
   **fixer** once with exactly those findings, then one re-review. Still failing →
   stop the loop and surface the task id, findings, and last worker output.
4. `minor` findings: record them (task ledger / progress notes); they are presented
   again at the PR stage, never silently dropped.
5. Next task/wave.

## Per-task loop — wave size ≥2 (both engines)

Same implement → review → (fix) → re-review shape as above, per task, run
concurrently across the wave, plus two additions:

1. **Implement (isolated).** Dispatch with `isolation: 'worktree'` — a
   same-tree concurrent self-commit is unsafe regardless of how disjoint the
   tasks' files are: `git add`/`git commit` mutate the single shared
   `.git/index` and `HEAD`, so two concurrent implementers can interleave
   such that one task's commit silently absorbs another's staged file —
   corruption with no error. **`isolation: 'worktree'` branches from the
   repo's default branch, not `branchName`** — its very first instruction
   must be `git reset --hard <branchName>` to bring the isolated worktree up
   to date with the actual work (this is a `reset`, not a `checkout`, of
   `branchName`: the isolated worktree's own throwaway branch moves to match
   that commit; `branchName` itself stays checked out, untouched, in the
   main worktree). Skipping this step means every wave after the first
   starts from a tree missing every prior wave's merged commits — for wave
   1 it's a no-op (nothing has been merged yet, so the default branch and
   `branchName` are identical), but it is never safe to skip on the
   assumption a task happens to be in wave 1. The implementer's return
   becomes a **structured** (schema) result — see `IMPL_RESULT` below —
   including `branch` (`git branch --show-current`) and `worktreePath`
   (`git rev-parse --show-toplevel`), self-reported from inside its own
   worktree. Do not rely on a tool-level "path and branch returned in the
   result" side-channel for this — that is documented for the top-level
   Agent tool's own return value, not confirmed for the Workflow-script
   `agent()` primitive; self-report works identically in both engines.
2. **Review.** Unchanged — no isolation, no path targeting: `git show
   <commitHash>` reads shared objects from any worktree, including the main
   checkout.
3. **Fix (if blocking findings).** Dispatched **without** `isolation` (that
   would mint a third, unrelated worktree) but instructed to operate at the
   implementer's reported `worktreePath`/`branch` so the fix commit lands on
   the same isolated branch. Re-review as usual.
4. **Merge-back (once per wave, after every task in it resolves).** Dispatched
   like the fixer, **without** `isolation` — its git commands are assumed to
   run in the main work-branch checkout (the primary worktree, on
   `branchName`), which is where a non-isolated `agent()` call runs by
   default. That default is itself session-dependent: in a linked/bridge
   worktree session, an Agent-tool subagent's default cwd is the *primary*
   repo root, not the bridge worktree — verify this holds for the session
   this skill is actually running in before trusting the merge-back's target,
   rather than assuming it. Given the ordered `{taskId, branch, worktreePath}`
   list for every task that reached `approved`, runs in task-id order:
   `git merge --no-ff <branch>`, then
   cleans up in the only order git allows — `git worktree remove
   <worktreePath>` **first**, then `git branch -d <branch>` (git refuses to
   delete a branch still checked out in a worktree). Disjoint files by
   construction ⇒ no *textual* conflict is expected. **A reported conflict
   is a hard stop** — it means the parallelism analysis missed a real
   dependency; surface the task ids, branches, and conflicting paths, and do
   not proceed to the next wave or attempt to resolve it. Scope note: a clean
   merge only proves no two tasks edited the same lines — it cannot catch a
   task whose `Consumes` silently mismatches what its dependency actually
   `Produces` (a semantic contract error, not a text conflict). This skill's own
   step 5 (Review, the combined review workflow over the full post-merge
   branch diff) is the actual backstop for that case; this merge-back step
   alone does not guarantee the wave analysis was semantically correct, only
   that it was textually non-overlapping.
5. **Partial-wave failure.** A task that fails (implementer `null` twice, or
   still failing after one fixer round) does not discard its wave siblings:
   still merge every other task in the wave that reached `approved`, then
   report the failed task and stop the whole pipeline — do not open a PR on
   a half-implemented plan. A task that fails after its implementer
   succeeded (review/fix stage) reports its `branch`/`worktreePath` in the
   failure too, so its abandoned worktree can be found for manual cleanup.
   Known gap, accepted: if the implementer itself dies before ever
   self-reporting `worktreePath` (`null` on both attempts), any worktree the
   tool minted for that dead attempt has no recorded path and is orphaned —
   there is no channel to recover it from, since the dead worker never
   returned anything.

## Engine selection

Probe once: `ToolSearch(query: "select:Workflow")`.

- **Available → Workflow engine (canonical).** This reference instructing the call
  is the documented opt-in for using it.
- **Absent → Agent engine.**
- Workflow rejects the script (meta/API validation error) → do not fight API drift;
  switch to the Agent engine.

## Workflow engine

**Do not pass `planPath`/`tasks`/`constraints` via the Workflow tool's `args`
parameter.** Observed twice in the same session: `args` came back `undefined`
inside the script (`Error: undefined is not an object (evaluating
'args.tasks')`, thrown before any `agent()` call ran) — once on a plain
`{script, args}` call, once again on a `{scriptPath, resumeFromRunId, args}`
retry with `args` re-supplied — even though both calls passed `args` as an
actual JSON object per the tool's documented contract. Root cause unconfirmed
(tool-side), but the failure is silent and total: the loop never starts, and
nothing distinguishes it from a script bug without reading the error. Instead,
**inline the values as JS literals directly in the script text** you send
(build the string with your own template literal before calling the tool) and
pass no `args` at all — this is the only invocation shape confirmed to work.
Adapt the prompt templates too if the plan demands extra context. `waves` is
**not** part of this inlining — it is computed inside the script by
`computeWaves(tasks)`, a plain function, not a value the caller hand-derives.

The script has no filesystem or Node.js API access (per the Workflow tool's
documented constraints), so the merge-back step also runs as an `agent()`
call (the merger's own Bash), never as inline script code.

```js
export const meta = {
  name: 'feature-development-implement',
  description: 'Implement plan tasks wave-parallel with per-task review',
  phases: [{ title: 'Implement' }],
}
// Inlined by the caller — NOT sourced from `args` (see note above):
const planPath = /* absolute plan temp path, as a JS string literal */
const constraints = /* the plan's Global Constraints section, as a JS string literal */
const branchName = /* the current work branch (git branch --show-current), as a JS string literal */
const tasks = /* the plan's `## Machine-readable tasks` JSON block, verbatim, as a JS array literal */

function normalizeFile(entry) {
  return entry.replace(/\s*\([^)]*\)\s*$/, '').trim() // drop a trailing "(lines N-M)" annotation — same file, different range still counts as an overlap
}

function computeWaves(tasksIn) {
  const tasks = [...tasksIn].sort((a, b) => Number(a.id) - Number(b.id)) // dependencies only point to a numerically smaller id — process in that order so waveOf[d] is always already set
  const waveOf = {}
  const filesOf = {}
  const producesOf = {}
  const waves = []
  for (const t of tasks) {
    filesOf[t.id] = new Set((t.files || []).map(normalizeFile))
    producesOf[t.id] = new Set(t.produces || [])
  }
  for (const t of tasks) {
    const consumes = new Set(t.consumes || [])
    let ambiguous = !t.files || !t.files.length || t.consumes == null || t.produces == null
    const deps = new Set()
    for (const other of tasks) {
      if (Number(other.id) >= Number(t.id)) continue // backward-only invariant: only strictly earlier tasks
      let edge = false
      for (const f of filesOf[other.id]) if (filesOf[t.id].has(f)) edge = true
      for (const c of consumes) if (producesOf[other.id].has(c)) edge = true
      if (edge) deps.add(other.id)
    }
    for (const c of consumes) {
      const matched = tasks.some((other) => Number(other.id) < Number(t.id) && producesOf[other.id].has(c))
      if (!matched) ambiguous = true // Consumes names nothing any earlier task Produces
    }
    if (ambiguous) for (const other of tasks) if (Number(other.id) < Number(t.id)) deps.add(other.id)
    let w = 1
    for (const d of deps) w = Math.max(w, waveOf[d] + 1)
    waveOf[t.id] = w
    waves[w - 1] = waves[w - 1] || []
    waves[w - 1].push(t.id)
  }
  return waves
}
const waves = computeWaves(tasks)

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
const IMPL_RESULT = {
  type: 'object',
  required: ['status', 'commitHash', 'branch', 'worktreePath', 'testEvidence', 'deviations'],
  properties: {
    status: { enum: ['done', 'blocked'] },
    commitHash: { type: 'string' },
    branch: { type: 'string' },
    worktreePath: { type: 'string' },
    testEvidence: { type: 'string' },
    deviations: { type: 'string' },
  },
}
const MERGE_RESULT = {
  type: 'object',
  required: ['results', 'worktreeRoot'],
  properties: {
    worktreeRoot: { type: 'string' }, // self-reported `git rev-parse --show-toplevel`; surfaces a wrong-cwd merge loudly instead of silently
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'status'],
        properties: {
          id: {},
          status: { enum: ['merged', 'conflict'] },
          detail: { type: 'string' },
        },
      },
    },
  },
}
const implementerBody = (t) => `Plan file: ${planPath} — Read it; execute ONLY task ${t.id} (${t.title}).
Global constraints (binding): ${constraints}
Work test-first: write the task's failing test, watch it fail, implement minimally,
watch it pass, run the task's verification commands. Commit the task as ONE commit
following the repo's commit conventions (no co-author trailers, no generated-with
footers). Touch nothing outside the task's scope.`
const implementerPrompt = (t) => `You are the implementer for exactly one plan task.
${implementerBody(t)}
Return: STATUS: done|blocked, the commit hash, test evidence (commands + output),
and any deviation from the plan.`
const isolatedImplementerPrompt = (t) => `You are the implementer for exactly one plan task,
running in your own isolated git worktree.
FIRST, before anything else: run \`git reset --hard ${branchName}\`. Your worktree was
branched from the repo's default branch, not ${branchName} — this step is required to
bring it up to date with the actual work; skipping it means you'd be working from a
stale/wrong base.
${implementerBody(t)}
Before returning, run \`git branch --show-current\`, \`git rev-parse --show-toplevel\`,
and \`git rev-parse HEAD\` (your commit hash) and report their exact output, along with
test evidence (commands + output) and any deviation from the plan. Return your result
through the structured output schema.`
const reviewerPrompt = (t, implReport) => `You are a read-only reviewer for one plan task.
Plan file: ${planPath} — Read it; review ONLY task ${t.id} (${t.title}).
Implementer report: ${implReport}
Diff the task's commit(s) against their parent. If the report includes a \`branch\`
field, that commit lives there — read it with \`git show <branch>\`/\`git log
<branch>\` without needing to check it out (refs are shared across worktrees).
Check spec compliance against the task text and these global constraints, then
correctness:
${constraints}
Do not re-run tests the implementer already ran — their report carries the evidence.
Return your verdict through the structured output schema.`
const fixerPrompt = (t, findings, worktreeNote = '') => `You are the fixer for one reviewed plan task.${worktreeNote}
Plan file: ${planPath}, task ${t.id} (${t.title}).
Apply exactly these findings — nothing else — then commit (repo conventions, no
co-author trailers): ${JSON.stringify(findings)}
Return: STATUS: done|blocked, commit hash, what changed.`
const isolatedFixerNote = (worktreePath, branch) => ` You are on branch ${branch} at ${worktreePath} — an isolated worktree; run your commands there, do not create a new one. A standalone \`cd\` does NOT persist to your next Bash call — chain \`cd "${worktreePath}" && ...\` into every single command (git and otherwise), or every command after the first silently runs in your default checkout instead.`
const mergerPrompt = (approved) => `Merge these approved task branches into the current
branch, in this exact order, one at a time: ${JSON.stringify(approved)} (each entry
is {id, branch, worktreePath}).
For each: run \`git merge --no-ff <branch>\`. On success, clean up in this exact
order — \`git worktree remove <worktreePath>\` FIRST, then \`git branch -d <branch>\`
(git refuses to delete a branch still checked out in a worktree, so deleting first
fails) — then continue to the next. If a cleanup command fails, report it but do
NOT treat it as a merge failure; the merge itself already succeeded.
On a merge conflict: STOP immediately, run \`git merge --abort\`, record that task's
id as a conflict with the conflicting paths, and do not continue to the remaining
branches (leave their worktrees/branches in place for manual inspection).
Before returning, also run \`git rev-parse --show-toplevel\` and report it — this
should be ${branchName}'s own checkout, not a worktree; if it isn't, something
dispatched you into the wrong place and the merge target is unreliable.
Return your result through the structured output schema — one entry per task
attempted (tasks after a conflict are simply omitted, not marked).`

async function runTask(t, isolated) {
  const implPrompt = isolated ? isolatedImplementerPrompt(t) : implementerPrompt(t)
  const implOpts = { label: `task:${t.id}`, phase: 'Implement', ...(isolated && { isolation: 'worktree', schema: IMPL_RESULT }) }
  let impl = await agent(implPrompt, implOpts)
  if (impl === null) impl = await agent(implPrompt, { ...implOpts, label: `task:${t.id}:retry` })
  if (impl === null) return { id: t.id, status: 'failed', reason: 'implementer returned null twice' }
  if (isolated && impl.status === 'blocked') {
    return { id: t.id, status: 'failed', reason: 'implementer reported blocked', branch: impl.branch, worktreePath: impl.worktreePath }
  }
  const implReportText = isolated ? JSON.stringify(impl) : impl
  let review = await agent(reviewerPrompt(t, implReportText), { label: `review:${t.id}`, phase: 'Implement', schema: VERDICT })
  if (review === null) review = await agent(reviewerPrompt(t, implReportText), { label: `review:${t.id}:retry`, phase: 'Implement', schema: VERDICT })
  if (review && !review.approved) {
    const blocking = review.findings.filter((f) => f.severity !== 'minor')
    if (blocking.length) {
      const fixPrompt = isolated ? fixerPrompt(t, blocking, isolatedFixerNote(impl.worktreePath, impl.branch)) : fixerPrompt(t, blocking)
      const fixResult = await agent(fixPrompt, { label: `fix:${t.id}`, phase: 'Implement' })
      const reReviewReport = isolated
        ? `Post-fix re-review. Branch: ${impl.branch} — the fix commit is the LATEST commit on that branch (run \`git log ${impl.branch} -1\`); diff that, not just the original commit. Original report: ${implReportText}. Fix report: ${fixResult}`
        : 'Post-fix re-review; diff the fix commit too.'
      review = await agent(reviewerPrompt(t, reReviewReport), {
        label: `re-review:${t.id}`,
        phase: 'Implement',
        schema: VERDICT,
      })
    }
  }
  const blockingLeft = !review || (!review.approved && review.findings.some((f) => f.severity !== 'minor'))
  if (blockingLeft) return { id: t.id, status: 'failed', review, branch: isolated ? impl.branch : null, worktreePath: isolated ? impl.worktreePath : null }
  return {
    id: t.id,
    status: 'done',
    branch: isolated ? impl.branch : null,
    worktreePath: isolated ? impl.worktreePath : null,
    minor: (review.findings || []).filter((f) => f.severity === 'minor'),
  }
}

const results = []
for (let i = 0; i < waves.length; i++) {
  const wave = waves[i]
  const waveTasks = wave.map((id) => tasks.find((t) => t.id === id))
  const isolated = waveTasks.length > 1
  log(`Wave ${i + 1}/${waves.length}: dispatching ${waveTasks.length} task(s)${isolated ? ' in parallel' : ''} (ids ${wave.join(', ')})`)
  // wave size 1 stays a single direct call — no parallel(), byte-for-byte the original sequential path
  const waveResults = isolated ? await parallel(waveTasks.map((t) => () => runTask(t, isolated))) : [await runTask(waveTasks[0], false)]
  results.push(...waveResults)
  let mergeFailed = false
  if (isolated) {
    const approved = waveResults.filter((r) => r && r.status === 'done').map((r) => ({ id: r.id, branch: r.branch, worktreePath: r.worktreePath }))
    if (approved.length) {
      let mergeReport = await agent(mergerPrompt(approved), { label: 'merge:wave', phase: 'Implement', schema: MERGE_RESULT })
      if (mergeReport === null) mergeReport = await agent(mergerPrompt(approved), { label: 'merge:wave:retry', phase: 'Implement', schema: MERGE_RESULT })
      if (mergeReport === null) {
        results.push({ id: 'merge', status: 'failed', reason: 'merger returned null twice' })
        mergeFailed = true
      } else {
        log(`Wave ${i + 1} merge ran in: ${mergeReport.worktreeRoot}`) // surfaces a wrong-cwd merge loudly instead of silently
        const conflicts = (mergeReport.results || []).filter((r) => r.status === 'conflict')
        if (conflicts.length) {
          results.push({ id: 'merge', status: 'failed', reason: JSON.stringify(conflicts) })
          mergeFailed = true
        }
      }
    }
  }
  if (mergeFailed || waveResults.some((r) => !r || r.status === 'failed')) break
}
return results
```

Script-environment facts (cross-check against the live Workflow tool schema before
use — probe it once with `ToolSearch(query: "select:Workflow")` and inspect its
description): plain JavaScript (no TypeScript syntax); `agent(prompt, {label, phase,
schema, isolation})` returns the worker's text, or the schema-validated object when
`schema` is passed, or `null` when the worker dies; `parallel(thunks)` takes an array
of **not-yet-invoked** zero-arg functions (`() => promise`, not already-started
promises) and awaits all of them, per the tool's own documented signature —
`waveTasks.map((t) => () => runTask(t, isolated))` matches this exactly; `log(message)`
emits a one-line progress note to the user, used above for the per-wave announcement;
`Date.now()`, `Math.random()`, and argless `new Date()` may not be available inside
scripts — inline any needed timestamp or id as a literal in the script text (computed
before you build the string), same as `planPath`/`constraints`/`branchName`/`tasks`
above (`waves` is derived inside the script, not inlined) — not via `args` (see the
Workflow engine note on why `args` is unreliable here).

After the workflow returns, read the results: any `status: 'failed'` entry → stop
and surface it; otherwise carry the collected `minor` findings forward to the PR
step.

## Agent engine (fallback)

Run the identical per-task loop yourself, dispatching each worker via the Agent tool
with the same prompts (substitute the placeholders by hand — including `branchName`,
captured once via `git branch --show-current` before Implement starts), computing
waves per the Parallelism analysis above. Wave size 1: strictly one dispatch at a
time, judge completion by the returned content, never by elapsed time. Wave size ≥2
gates at wave-batch granularity rather than per-task (a fast task's review waits for
its slowest wave-mate's implementer) — simpler than a fully per-task-granular
dispatch and still an improvement over serializing every dispatch, but not literally
identical wall-clock behavior to the Workflow engine's per-task `parallel()` pipeline:

- **Implement.** Dispatch that wave's implementers together in a single message
  (multiple Agent tool-use blocks, each with `isolation: 'worktree'`) — the
  documented pattern for running agents in parallel. Each implementer's prompt
  must include the `git reset --hard <branchName>` first-instruction from the
  Per-task-loop section above — `isolation: 'worktree'` branches from the repo's
  default branch here too, not from this session's current branch.
- **Review.** Once every implementer in the batch is reconciled, dispatch that
  wave's reviewers together the same way — one message, multiple blocks. A
  review is read-only (`git show <commitHash>` needs no isolation and no
  checkout), so nothing about it requires the one-at-a-time discipline a
  self-committing implementer needs; serializing reviews would only add
  wall-clock time for no safety benefit.
- **Fix.** Batch the fixer dispatches for whichever tasks in the wave have
  blocking findings, one message, multiple blocks — each fixer already
  targets its own pre-existing isolated worktree, so concurrent fixers are as
  safe as concurrent implementers. Re-review each fixed task, batched the
  same way.
- **Merge-back.** Run this via the orchestrator's own Bash — you already hold
  `Bash` directly (this skill's own `allowed-tools`) — run the merge-back's
  `git merge --no-ff <branch>` /
  `git worktree remove <worktreePath>` / `git branch -d <branch>` sequence
  yourself, in task-id order, rather than dispatching a separate merger
  subagent for it (that indirection exists only because the Workflow
  engine's sandboxed script has no Bash of its own). A non-zero `git merge`
  exit is a conflict: run `git merge --abort` and treat it as the same hard
  stop described above.

> **Subagent reconciliation gate.** Track every async dispatch so you never advance
> on a partial batch and never miss a finish. Load the ledger tools once (deferred;
> resolve at depth 0, where this skill runs — a subagent-scoped probe falsely reports
> these absent, do NOT skip the ledger on that basis):
> `ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`
> (retry bare names). Only if the CRUD ledger tools (TaskCreate/TaskUpdate/TaskList)
> fail to load, use the prose-count fallback below — TaskStop loading alone is not
> sufficient to activate the ledger path.
>
> 1. On dispatch, `TaskCreate` one entry per worker actually dispatched
>    (`subject` = implementer/reviewer/fixer + task id, `metadata.dispatch_id`
>    = its Agent `task_id`), then `TaskUpdate` it to `in_progress` — one entry
>    per task when dispatching a whole wave's batch together.
> 2. On each `<task-notification>`, match by `dispatch_id`, record the worker's
>    structured result, `TaskUpdate` → `completed` (soft-fail returns are terminal).
> 3. **Gate:** before dispatching a wave's reviewers, before dispatching a
>    wave's fixers, before running that wave's merge-back, and before
>    starting the next wave, `TaskList`; if any entry in the current batch is
>    still `pending`/`in_progress`, do NOT advance — wait for the remaining
>    `<task-notification>`(s).
> 4. Escape hatch only: if, when next awake, a still-`in_progress` entry is judged
>    genuinely stuck, `TaskStop` its `dispatch_id`, mark it terminal, record a
>    soft-failure, proceed. Never `TaskOutput` a dispatch_id (transcript overflow).
> Prose-count fallback (CRUD ledger tools genuinely absent): track the dispatched
> count explicitly; do not advance until that many structured results are in hand.

## Exit

All tasks `done` → return to this skill's own step 5, Review, which does not
consume the minor-findings list — carry it forward unchanged to `fresh-work`'s
PR step (invoked after this skill returns) for presentation. Any task failed, or a wave's merge-back conflicted → report
it and stop; do not open a PR on a half-implemented plan.
