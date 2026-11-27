# build-task ship script — usage reference

Delivery pipeline, phase 4 of 4: PR/MR text → push, PR/MR create-or-update,
mergeability → CI watch with bounded fix rounds. build-task does not run this
script when the user asked not to open a PR/MR.

## Contents

- [Invocation](#invocation)
- [Parameters (`args` object)](#parameters-args-object)
- [Preconditions](#preconditions)
- [Result (exit contract)](#result-exit-contract)
- [Behavior notes](#behavior-notes)

## Invocation

**Primary:** `Workflow({ name: "taskflow:build-task-ship", args })`
with ONE structured `args` object — the script reads it as the global `args`.
The runtime may deliver the object as a JSON string; `decodeArgs` parses that
transparently.

**Fallback** — only when the return is `stage: 'args'` and its `error` starts
with `args global is undefined`: Read `<PLUGIN_ROOT>/workflows/build-task-ship.workflow.js`, prepend
exactly one line after the `meta` block — `const args = { … }` as a JSON object
literal — and submit the whole text via the Workflow tool's `script`
parameter, without the tool-level `args` parameter. Any other
`stage: 'args'` error means a malformed payload: fix the call.

Role agents: the four ship roles are plugin agents (`taskflow:pr-author`,
`taskflow:shipper`, `taskflow:ci-monitor`, `taskflow:ci-fixer`, `agents/`),
dispatched via `agentType`; the script's `model` option overrides their
frontmatter model.

## Parameters (`args` object)

| Key                   | Type    | Required | Meaning                                                                                                                                                                      |
| :-------------------- | :------ | :------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPEC_PATH`           | string  | yes      | Absolute path of the user-approved spec file (PR/MR context)                                                                                                                 |
| `PLAN_PATH`           | string  | yes      | Absolute path of the plan file (PR/MR context)                                                                                                                               |
| `IMPLEMENT_PATH`      | string  | yes      | Absolute path of the implement result file (the implement script's `implementPath`) — Read by the pr-author                                                                  |
| `REVIEW_PATH`         | string  | yes      | Absolute path of the review result file written by the skill in step 5.3 — Read by the pr-author                                                                             |
| `PR_BODY_PATH`        | string  | yes      | Absolute temp path the pr-author writes the PR/MR body to (`pr-body-<slug>.md`); the shipper reads it back                                                                   |
| `BRANCH_NAME`         | string  | yes      | Current work branch (`git branch --show-current`)                                                                                                                            |
| `GRAPHMIND_AVAILABLE` | boolean | no       | `false` (default). `true` ⇒ the ci-fixer get a hint to use the graphmind MCP tools (`project` as given). Requires a non-empty absolute `REPO_PATH`                           |
| `REPO_PATH`           | string  | no       | `''` (default). Absolute checkout root (`git rev-parse --show-toplevel`). **Required when `GRAPHMIND_AVAILABLE` is `true`**                                                  |
| `JEV_AVAILABLE`       | boolean | no       | `false` (default). `true` ⇒ the ci-monitor and ci-fixer get a hint to use jev-api's `request` tool (a `choice` question); they accept its answer only at `confidence >= 0.6` |
| `BASE_BRANCH`         | string  | no       | Branch the work branch was cut from. Default `main`. PR/MR target                                                                                                            |
| `PLUGIN_ROOT`         | string  | no       | Default `''`. Absolute plugin root; builds the `bin/ship-ensure-mergeable.mjs` path handed to the shipper. Empty or an unresolved `${…}` token → remediation skipped         |

Guards: missing required keys, or a `SPEC_PATH`, `PLAN_PATH`,
`IMPLEMENT_PATH`, `REVIEW_PATH`, or `PR_BODY_PATH` that is not an
absolute path return `status: 'error', stage: 'args'` before any agent is
dispatched. There is no ship on/off arg: the script always ships when run.

## Preconditions

- The implement script and the review step completed: both result files exist and all
  work is committed on `BRANCH_NAME`. A missing or unreadable result file
  surfaces through the pr-author (null twice → `ship.status: 'blocked'`). A pre-check (`test -s`) of the implement and review result files fails closed: a missing or empty file also yields `blocked`, before anything is pushed.

## Result (exit contract)

One structured object; `status` is the discriminator. Consume only this return.

### `status: 'complete'`

| Field  | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| :----- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ship` | `{status, url?, platform?, prAction?, mergeState?, ci?, detail?}` — `status`: `shipped` (CI green or no CI), `ci_failed` (red after fix budget — human takes over at `url`), `ci_timeout` (still running after monitor budget), `ci_unknown` (monitor failed), `blocked` (pr-author failed, push/CLI/auth problem OR merge-state remediation failure, see `detail`). Before CI monitoring, shipper auto-updates a `behind` branch and auto-resolves `-X ours`-clean conflicts, reporting `mergeState` (`clean`/`rebased`/`resolved`/`unknown`). `ci` carries `{status, monitorRounds, fixRounds, failedJobs?, fixDetail?}` |

Ship problems are reportable states, never `status: 'error'` — the work is
committed either way.

### `status: 'error'`

| `stage` | Meaning                                                                          | Action                                                          |
| :------ | :------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| `args`  | Invocation malformed (missing keys, relative path) or `args global is undefined` | Fallback for `args global is undefined`; otherwise fix the call |

## Behavior notes

- `pr-author` (`haiku` alias) Reads the implement and review result files plus
  the spec and plan and writes a faithful title/body (repo template respected;
  the review file carries size, level, review commits and summary);
  the body goes to `PR_BODY_PATH` with the Write tool (one retry).
- `shipper` (`haiku`) pushes (NEVER force), creates-or-updates the PR/MR
  idempotently, then runs `bin/ship-ensure-mergeable.mjs` to ensure it is
  mergeable before ci-monitor runs (auto-updates a `behind` branch via the
  platform API; auto-resolves conflicts with a `git merge -X ours`, non-force,
  bailing to `blocked` on conflicts `-X ours` cannot cleanly resolve),
  reporting `mergeState`.
- `ci-monitor` (`haiku`, read-only by role-file instruction: Bash only) waits
  bounded (~5 min per round, max 6 rounds) and classifies; `ci-fixer`
  (`sonnet` alias) classifies flaky/infra (one rerun) vs code-caused (minimal
  in-scope fix, one commit, plain push) vs base-broken (blocked), max 2 fix
  rounds.
- The stage never merges the PR/MR itself, never force-pushes, never
  retargets/touches the base, and never weakens tests or CI config.
