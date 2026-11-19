# build-task plan script — usage reference

Delivery pipeline, phase 1 of 4: approved spec → implementation plan → plan
check → at most one revision round → recheck. The planner writes the plan
file the implement script consumes.

## Contents

- [Invocation](#invocation)
- [Parameters (`args` object)](#parameters-args-object)
- [Preconditions](#preconditions)
- [Result (exit contract)](#result-exit-contract)
- [Behavior notes](#behavior-notes)

## Invocation

**Primary:** `Workflow({ name: "taskflow:build-task-plan", args })`
with ONE structured `args` object — the script reads it as the global `args`.
The runtime may deliver the object as a JSON string; `decodeArgs` parses that
transparently.

**Fallback** — only when the return is `stage: 'args'` and its `error` starts
with `args global is undefined`: Read `<PLUGIN_ROOT>/workflows/build-task-plan.workflow.js`, prepend
exactly one line after the `meta` block — `const args = { … }` as a JSON object
literal — and submit the whole text via the Workflow tool's `script`
parameter, without the tool-level `args` parameter. Any other
`stage: 'args'` error means a malformed payload: fix the call.

Role agent: the planner is the plugin agent `taskflow:planner` (`agents/`,
dispatched via `agentType`, model from the script). The plan
checker is a fully inline agent.

## Parameters (`args` object)

| Key                   | Type    | Required | Meaning                                                                                                                                                     |
| :-------------------- | :------ | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPEC_PATH`           | string  | yes      | Absolute path of the user-approved spec file (the spec script's `specPath`)                                                                                 |
| `PLAN_PATH`           | string  | yes      | Absolute temp path where the planner writes the plan (session scratch, never in the repo)                                                                   |
| `SIZE`                | string  | no       | `''` (default). Task size `S` / `M` / `L` / `XL` from build-task's size step (case-insensitive); picks the planner model                                    |
| `GRAPHMIND_AVAILABLE` | bool    | no       | Default `false`. `true` ⇒ the planner confirms paths/signatures via the graphmind MCP tools (`project` = `REPO_PATH`)                                       |
| `REPO_PATH`           | string  | no       | Default `''`. Absolute checkout root (`git rev-parse --show-toplevel`). **Required when `GRAPHMIND_AVAILABLE` is `true`**                                   |
| `JEV_AVAILABLE`       | boolean | no       | `false` (default). `true` ⇒ the planner get a hint to use jev-api's `request` tool (a `score` question); they accept its answer only at `confidence >= 0.6` |

Guards: missing required keys, a `SPEC_PATH` or `PLAN_PATH` that
is not an absolute path, or `GRAPHMIND_AVAILABLE: true` with an empty or
non-absolute `REPO_PATH` return `status: 'error', stage: 'args'` before any
agent is dispatched.

## Preconditions

- Spec approved by the user and readable by subagents.

## Result (exit contract)

One structured object; `status` is the discriminator. Consume only this return.

### `status: 'complete'`

| Field          | Meaning                                                                                                                                |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| `planPath`     | The plan file (`PLAN_PATH`) — contains `## Global Constraints` and the `## Machine-readable tasks` JSON block; never Read by the skill |
| `plannerModel` | The model alias the planner ran on (after any `fable` fallback) — for the final report                                                 |

### `status: 'error'`

| `stage` | Meaning                                                                                                              | Action                                                                          |
| :------ | :------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------ |
| `args`  | Invocation malformed (missing keys, relative path, graphmind flag without `REPO_PATH`) or `args global is undefined` | Fallback for `args global is undefined`; otherwise fix the call                 |
| `Plan`  | Planner null twice or blocked, or the plan is still blocking after one revision round                                | Surface `error`; nothing was implemented. Carries `planPath` and `plannerModel` |

## Behavior notes

- Planner model from `SIZE`: S sonnet / M opus / L opus / XL fable; unset or
  unknown → `opus`. A `fable` dispatch that throws (no Fable access) falls
  back to `opus` for the rest of the run, and a `null` result on `fable` is
  retried on `opus`. There is no spec classifier: the size comes from
  build-task.
- The plan checker runs on the `sonnet` alias: coverage, placeholders,
  consistency and the machine-readable block; blocking findings trigger one
  planner revision round and a recheck.
- The plan is written entirely in English regardless of the spec's language.
- With `GRAPHMIND_AVAILABLE: true` the planner prompt tells the planner to
  load and prefer the graphmind tools (`gm_search`, `gm_outline`, `gm_fn`,
  `project` = `REPO_PATH`) and to fall back to Read/Grep. Availability is
  probed once by build-task, never by this script.
