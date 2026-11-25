# build-task implement script — usage reference

Delivery pipeline, phase 2 of 4: load the plan's tasks → compute waves → per
task implement, review, at most one fix → per-wave merge for multi-task waves
→ write the implement result file.

## Contents

- [Invocation](#invocation)
- [Parameters (`args` object)](#parameters-args-object)
- [Preconditions](#preconditions)
- [Result (exit contract)](#result-exit-contract)
- [Behavior notes](#behavior-notes)

## Invocation

**Primary:** `Workflow({ name: "taskflow:build-task-implement", args })`
with ONE structured `args` object — the script reads it as the global `args`.
The runtime may deliver the object as a JSON string; `decodeArgs` parses that
transparently.

**Fallback** — only when the return is `stage: 'args'` and its `error` starts
with `args global is undefined`: Read `<PLUGIN_ROOT>/workflows/build-task-implement.workflow.js`, prepend
exactly one line after the `meta` block — `const args = { … }` as a JSON object
literal — and submit the whole text via the Workflow tool's `script`
parameter, without the tool-level `args` parameter. Any other
`stage: 'args'` error means a malformed payload: fix the call.

Role agent: the merger is the plugin agent `taskflow:worktree-merger`
(`agents/`, dispatched via `agentType`, model from the script). The
plan loader, implementer, per-task reviewer, fixer and scribe are fully inline
agents.

## Parameters (`args` object)

| Key                   | Type    | Required | Meaning                                                                                                                                                                                                                                                 |
| :-------------------- | :------ | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PLAN_PATH`           | string  | yes      | Absolute path of the plan file the plan script wrote (its `planPath`)                                                                                                                                                                                   |
| `IMPLEMENT_PATH`      | string  | yes      | Absolute temp path of the JSON result file this script writes (`implement-<slug>.json`)                                                                                                                                                                 |
| `BRANCH_NAME`         | string  | yes      | Current work branch (`git branch --show-current`)                                                                                                                                                                                                       |
| `SCRATCH_DIR`         | string  | yes      | Absolute session-scratch directory, trailing slash included (build-task's `<session scratchpad>/build-task/`) — implementers write `test-evidence-task-<id>.txt` there for the reviewer                                                                 |
| `GRAPHMIND_AVAILABLE` | boolean | no       | `false` (default). `true` ⇒ the implementers, per-task reviewers and fixers (`project` = their own checkout, `git rev-parse --show-toplevel`) get a hint to use the graphmind MCP tools (`project` as given). Requires a non-empty absolute `REPO_PATH` |
| `REPO_PATH`           | string  | no       | `''` (default). Absolute checkout root (`git rev-parse --show-toplevel`). **Required when `GRAPHMIND_AVAILABLE` is `true`**                                                                                                                             |

Guards: missing required keys, or a `PLAN_PATH`, `IMPLEMENT_PATH`,
or `SCRATCH_DIR` that is not an absolute path return
`status: 'error', stage: 'args'` before any agent is dispatched.

## Preconditions

- Work branch (`BRANCH_NAME`) checked out, `git status --porcelain` empty. On
  the `dispatch-task` path (where build-task's step 1 check was skipped via
  `--skip-branch-check`), this is guaranteed by dispatch-task's fresh
  `claude --worktree` cut and its own `git checkout -b "feature/<slug>"`.
- Worktree isolation (multi-task waves) branches from the repo's DEFAULT
  branch — the script compensates by hard-resetting each isolated implementer
  to `BRANCH_NAME` first.

## Result (exit contract)

One structured object; `status` is the discriminator. Consume only this
return. Every return after the args check carries `tasks`, `waves` and
`minorFindings`, so per-task results can be reported without reading a file.

### `status: 'complete'`

| Field           | Meaning                                                                                                                                                  |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `implementPath` | The result file (`IMPLEMENT_PATH`): `{branch, plan, tasks, waves, taskResults, minorFindings}` — read by the ship script's pr-author, never by the skill |
| `tasks`         | `[{id, title, complexity, model, status}]` — model per task from complexity (trivial→haiku, standard→haiku, complex→`opus`); `status` `done`             |
| `waves`         | Wave layout, e.g. `[[1,2],[3]]` — file-overlap ∪ consumes→produces ∪ conservative fallback                                                               |
| `minorFindings` | Non-blocking per-task review findings `[{id, minor: [...]}]` — pass through to the final report                                                          |

### `status: 'error'`

| `stage`     | Meaning                                                                                                                                                                                                | Action                                                                                                                                                                                                                                                                                                                                                         |
| :---------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `args`      | Invocation malformed (missing keys, relative path) or `args global is undefined`                                                                                                                       | Fallback for `args global is undefined`; otherwise fix the call                                                                                                                                                                                                                                                                                                |
| `Implement` | The plan tasks could not be loaded (`tasks`, `waves`, `results` empty), a task failed, a merger failed or a wave merge hit a conflict (multi-task waves only), or the result file could not be written | HARD STOP. Never retry the merge, never resolve conflicts, never continue on a half-implemented plan. Carries `tasks` (status `done`/`failed`/`pending`), `waves`, `results` and `minorFindings`; `results` (the per-task `taskResults`: `{id, status, branch, worktreePath, …}`) names abandoned worktrees/branches or left-behind commits for manual cleanup |

A wave-merge conflict means the wave analysis missed a real dependency — that
is a planning defect to surface, not a git problem to solve. When only the
result file could not be written, all tasks are committed on `BRANCH_NAME`.

## Behavior notes

- One `haiku` loader agent reads `## Global Constraints` and the
  `## Machine-readable tasks` JSON block from the plan through a schema; the
  script rejects an empty list, non-numeric or duplicate ids, or a task count
  that differs from the plan's `### Task` heading count (one retry).
- Waves with more than one task: every implementer runs with
  `isolation: 'worktree'`, and the wave is merged by a separate merger agent
  (`git merge --no-ff`, task-id order, worktree cleanup before branch delete).
- Waves with exactly one task (single-task wave): the implementer runs
  non-isolated and commits directly on the work branch; no merger runs. It
  verifies branch == `BRANCH_NAME` and a clean tree itself (prompt-level guard);
  the per-task reviewer re-checks the branch and commit. A failure leaves its
  commits on the work branch for manual revert.
- The per-task review gate runs on the `haiku` alias for `trivial` and
  `standard` tasks and on the `sonnet` alias for `complex` tasks; depth comes
  from the review script, never from the per-task gate. The implementer runs
  on `haiku` (`opus` for `complex` tasks); the per-task fixer reuses the
  implementer's model. Loader, merger and scribe run on `haiku`.
- The result file is written by a `haiku` scribe with the Write tool (one retry,
  same method), reported size from a separate `wc -c`; that size must equal the
  expected byte count (or that plus a trailing newline; one retry) — a truncated JSON file is
  never accepted.
