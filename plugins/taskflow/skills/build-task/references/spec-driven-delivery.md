# /taskflow:spec-driven-delivery — usage reference

Delivery pipeline for an APPROVED spec: Plan → wave-parallel Implement (every
implementer in its own isolated worktree, each wave merged by a dedicated
merger agent) → combined Review → fix application.

## Invocation

**Primary:** run the plugin workflow with `Workflow({name: "taskflow:spec-driven-delivery", args})`
— **no leading `/`** on `name` (the `/taskflow:spec-driven-delivery` display form is how the
workflow is described/run as a slash command, not the literal tool-call value; a leading
`/` makes the tool report the name as not found). Pass ONE structured `args` object — the
script reads it as the global `args`.

**Fallback** (workflow not registered): read
`${CLAUDE_PLUGIN_ROOT}/workflows/spec-driven-delivery.workflow.js`, prepend
exactly one line after the `meta` block — `const args = { … }` as a JSON
object literal — and submit via the Workflow tool's `script` parameter. NEVER
pass the tool-level `args` parameter on an ad-hoc `{script}` call: the global
arrives `undefined` there; the template's `decodeArgs` guard returns
`stage: 'args'` instead of failing silently.

Agent dependency: the static role prompts live in this plugin's `agents/`
directory and are addressed via `agentType` (namespaced `taskflow:<name>`;
rename together with the plugin). An unknown type throws hard at dispatch
("agent type 'X' not found. Available agents: ..."), so both invocation paths
— named AND ad-hoc fallback — require the plugin's agents to be loaded.

## Parameters (`args` object)

| Key           | Type   | Required | Meaning                                                                                                                    |
| :------------ | :----- | :------- | :------------------------------------------------------------------------------------------------------------------------- |
| `SPEC_PATH`   | string | yes      | Absolute path of the user-approved spec file                                                                               |
| `PLAN_PATH`   | string | yes      | Absolute temp path where the planner writes the plan (session scratch, never in the repo)                                  |
| `BRANCH_NAME` | string | yes      | Current work branch (`git branch --show-current`)                                                                          |
| `BASE_BRANCH` | string | no       | Branch the work branch was cut from. Default `main`. Drives the review diff `git diff <base>...HEAD`                       |
| `SHIP`        | bool   | no       | Default `true`. Run the Ship stage (push, PR/MR create-or-update, CI watch + bounded fix rounds); `false` ends after Apply |

Delivery format (primary/named-workflow invocation): the runtime may hand
`args` to the script as a JSON STRING depending on the invocation path —
`decodeArgs` parses string deliveries (including double-encoded)
transparently. On this path, a `stage: 'args'` error always means genuinely
malformed input (free text, array, missing keys), never a threading quirk —
fix the payload; do not switch to the fallback. On the ad-hoc fallback path,
the same `stage: 'args'` error can ALSO mean the threading quirk described
above (the tool-level `args` parameter was passed instead of prepending
`const args = {…}` to the script text) — check the invocation shape first
before assuming malformed content.

## Preconditions

- Work branch checked out, `git status --porcelain` empty.
- Spec approved by the user and readable by subagents.
- Worktree isolation branches from the repo's DEFAULT branch — the template
  compensates by hard-resetting every implementer to `BRANCH_NAME` first.

## Result (exit contract)

The workflow returns ONE structured object; `stage` is the discriminator.
Consume only this return — never re-derive state from transcript output.

### `stage: 'done'` — full pipeline succeeded

| Field                    | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| :----------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan`                   | `{path, tasks: [{id, title, complexity, model}]}` — model per task from complexity (trivial→haiku, standard→sonnet, complex→`claude-opus-4-8`); planner and synthesizer pinned to `claude-opus-4-8`                                                                                                                                                                                                                                                                                             |
| `waves`                  | Wave layout, e.g. `[[1,2],[3]]` — file-overlap ∪ consumes→produces ∪ conservative fallback                                                                                                                                                                                                                                                                                                                                                                                                      |
| `taskResults`            | Per task: `{id, status, branch, worktreePath, minor}`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `implementMinorFindings` | Non-blocking per-task review findings — pass through to the final report/PR                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `review`                 | `{level, finders, candidates, verifierAgents, verified, refuted, summary, findings}`                                                                                                                                                                                                                                                                                                                                                                                                            |
| `refuted`                | Candidates the independent verifiers disproved (transparency)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `applied`                | `{applied: [indexes], skipped: [{index, reason}], commits: [hashes]}` from the fix-application agent                                                                                                                                                                                                                                                                                                                                                                                            |
| `escalatedToUser`        | Findings whose fix would REVERSE an approved-spec decision — NEVER auto-applied; the caller must decide (AskUserQuestion), apply accepted ones itself, and commit them                                                                                                                                                                                                                                                                                                                          |
| `ship`                   | `{status, url?, platform?, prAction?, ci?}` — `status`: `shipped` (CI green or no CI), `ci_failed` (red after fix budget — human takes over at `url`), `ci_timeout` (still running after monitor budget), `ci_unknown` (monitor failed), `blocked` (push/CLI/auth problem, see `detail`), `skipped` (`SHIP: false`). `ci` carries `{status, monitorRounds, fixRounds, failedJobs?, fixDetail?}`. Ship problems are reportable states, never a pipeline error — the work is committed either way |

### Error stages

| `stage`     | Meaning                                                                    | Action                                                                                                                                                                                        |
| :---------- | :------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `args`      | Invocation malformed (no args / missing required keys)                     | Fix the call — do not debug the pipeline                                                                                                                                                      |
| `Plan`      | Planner failed/blocked, or plan still blocking after one revision round    | Surface `error`; nothing was implemented                                                                                                                                                      |
| `Implement` | A task failed, a merger failed, or a wave merge hit a conflict — HARD STOP | Never retry the merge, never resolve conflicts, never open a PR on a half-implemented plan. `results` names abandoned worktrees/branches for manual cleanup; partial `minorFindings` included |
| `Review`    | Scope agent failed or found no diff after a merged implement phase         | Surface `error` + partial `results`                                                                                                                                                           |

A wave-merge conflict means the wave analysis missed a real dependency — that
is a planning defect to surface, not a git problem to solve.

## Behavior notes

- The per-task review gate follows task complexity: `trivial` → `haiku`,
  `standard`/`complex` → `sonnet` alias; depth comes from the combined
  Review phase, never from the per-task gate. Recall-critical roles (finder,
  verifier), the plan-check gate, and the fix applier all stay on the
  `sonnet` alias (fix applier: pre-verified findings, test gate as safety
  net).
- Every implementer runs with `isolation: 'worktree'` — no direct commits on
  the work branch, even for single-task waves.
- Each wave is merged by a separate merger agent (`git merge --no-ff`, task-id
  order, worktree cleanup before branch delete).
- Review depth auto-scales: any `complex` task or >4 tasks → `max` level
  (5 correctness angles + 5 cleanup lenses + gap sweep, cap 15), else `high`.
- Ship stage roles: `pr-author` (`sonnet` alias) writes a faithful
  title/body from the pipeline summary (repo template respected, escalated
  findings listed as open items); `shipper` (`haiku`) pushes (NEVER force)
  and creates-or-updates the PR/MR idempotently; `ci-monitor` (`haiku`,
  read-only) waits bounded (~5 min per round, max 6 rounds) and classifies;
  `ci-fixer` (`sonnet` alias) classifies flaky/infra (one rerun) vs
  code-caused (minimal in-scope fix, one commit, plain push) vs base-broken
  (blocked), max 2 fix rounds. The stage never merges, never force-pushes,
  never retargets a PR/MR base, and never weakens tests or CI config.
- Fix application skips and reports anything that would change intended
  behavior, contradict the spec, or break the test run — see `applied.skipped`.
