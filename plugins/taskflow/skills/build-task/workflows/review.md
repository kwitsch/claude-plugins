# build-task review script — usage reference

Delivery pipeline, phase 3 of 4: combined review over the accumulated branch
diff (correctness angles + cleanup lenses, independently verified, plus a
report-only lean pass) → fix application → write the review result file.

## Contents

- [Invocation](#invocation)
- [Parameters (`args` object)](#parameters-args-object)
- [Preconditions](#preconditions)
- [Result (exit contract)](#result-exit-contract)
- [Behavior notes](#behavior-notes)

## Invocation

**Primary:** `Workflow({ name: "taskflow:build-task-review", args })`
with ONE structured `args` object — the script reads it as the global `args`.
The runtime may deliver the object as a JSON string; `decodeArgs` parses that
transparently.

**Fallback** — only when the return is `stage: 'args'` and its `error` starts
with `args global is undefined`: Read `<PLUGIN_ROOT>/workflows/build-task-review.workflow.js`, prepend
exactly one line after the `meta` block — `const args = { … }` as a JSON object
literal — and submit the whole text via the Workflow tool's `script`
parameter, without the tool-level `args` parameter. Any other
`stage: 'args'` error means a malformed payload: fix the call.

Plugin agent dependency: the finders, verifiers and the fix applier are the
plugin agents `taskflow:review-finder`, `taskflow:review-verifier` and
`taskflow:fix-applier` (static role prompts in the plugin's `agents/`
directory, addressed via `agentType`). An unknown type throws hard at
dispatch, so both invocation paths require the taskflow plugin to be loaded.
The scope, lean-review, synthesizer and scribe agents are fully inline.

## Parameters (`args` object)

| Key                   | Type    | Required | Meaning                                                                                                                                                                                                                                 |
| :-------------------- | :------ | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPEC_PATH`           | string  | yes      | Absolute path of the user-approved spec file (reversal judgment, lean pass, fix-applier skip rule)                                                                                                                                      |
| `PLAN_PATH`           | string  | yes      | Absolute path of the plan file (design/plan context for the synthesizer)                                                                                                                                                                |
| `REVIEW_PATH`         | string  | yes      | Absolute temp path of the JSON result file this script writes (`review-<slug>.json`)                                                                                                                                                    |
| `BRANCH_NAME`         | string  | yes      | Current work branch (`git branch --show-current`)                                                                                                                                                                                       |
| `BASE_BRANCH`         | string  | no       | Branch the work branch was cut from. Default `main`. Drives the review diff `git diff <base>...HEAD`                                                                                                                                    |
| `LEVEL`               | string  | no       | Review depth, `high` (default) or `max`. Chosen by build-task from its size: `S`/`M` → `high`, `L`/`XL` → `max`. Never derived in-script                                                                                                |
| `GRAPHMIND_AVAILABLE` | boolean | no       | `false` (default). `true` ⇒ the fix applier (the finders and verifiers keep their fixed tool allowlists, so they get no hint) get a hint to use the graphmind MCP tools (`project` as given). Requires a non-empty absolute `REPO_PATH` |
| `REPO_PATH`           | string  | no       | `''` (default). Absolute checkout root (`git rev-parse --show-toplevel`). **Required when `GRAPHMIND_AVAILABLE` is `true`**                                                                                                             |

Guards: missing required keys, a `SPEC_PATH`, `PLAN_PATH` or `REVIEW_PATH`
that is not an absolute path, or a `LEVEL` other than `high`/`max` return
`status: 'error', stage: 'args'` before any agent is dispatched.

## Preconditions

- Work branch checked out, `git status --porcelain` empty (the implement
  script finished cleanly) — the scope agent re-checks this and reports stray
  working-tree state instead of reviewing.

## Result (exit contract)

One structured object; `status` is the discriminator. Consume only this return.

### `status: 'complete'`

| Field             | Meaning                                                                                                                                                                                                                                                                                                                                    |
| :---------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reviewPath`      | The result file (`REVIEW_PATH`): `{level, summary, stats, findings, refuted, ponytailReview, applied, escalated}` — read by the ship script's pr-author, never by the skill. `findings` carries `reversesDecision` on each entry; `applied.applied` and `applied.skipped[].index` index into `findings.filter((f) => !f.reversesDecision)` |
| `level`           | The review level that ran (`high` / `max`)                                                                                                                                                                                                                                                                                                 |
| `summary`         | 2-3 sentence review summary from the synthesizer                                                                                                                                                                                                                                                                                           |
| `stats`           | `{level, finders, candidates, verifierAgents, verified, refuted}`                                                                                                                                                                                                                                                                          |
| `findingCount`    | Number of findings that survived verification and synthesis (the full list lives only in the result file)                                                                                                                                                                                                                                  |
| `applied`         | `{applied: [indexes], skipped: [{index, reason}], commits: [hashes]}` from the fix-application agent                                                                                                                                                                                                                                       |
| `escalatedToUser` | Findings whose fix would REVERSE an approved-spec decision — NEVER auto-applied; the caller must decide (AskUserQuestion), apply accepted ones itself, and commit them                                                                                                                                                                     |
| `ponytailReview`  | `{findings: [{file, line?, tag, what, replacement}], verdict}` — a separate, independently-verified and deduped, report-only over-engineering ("lean") pass over the same review diff; tags `delete`/`stdlib`/`native`/`yagni`/`shrink`. NEVER auto-applied and never escalated; surfaced in the report and the PR body only               |

### `status: 'error'`

| `stage`  | Meaning                                                                                                                                                 | Action                                                                                                                           |
| :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------- |
| `args`   | Invocation malformed (missing keys, relative path, invalid `LEVEL`) or `args global is undefined`                                                       | Fallback for `args global is undefined`; otherwise fix the call                                                                  |
| `Review` | Scope agent failed, the working tree was not clean, or there is no diff to review — the error carries NO `applied`/`escalatedToUser` keys               | Surface `error`, stop                                                                                                            |
| `Review` | The result file could not be written (fixes already committed) — the error additionally carries `level`, `applied`, `escalatedToUser`, `ponytailReview` | Do not stop: handle the escalations and report from these fields, and skip the ship script (its pr-author needs the result file) |

## Behavior notes

- `LEVEL: 'max'` runs 5 correctness angles + 5 cleanup lenses + a gap sweep,
  cap 15 findings; `high` runs 3 correctness angles + 5 cleanup lenses, cap 10.
  The size → level mapping is build-task's job (step 4); the script takes the
  level as given.
- Models: finder, verifier, fix applier and lean review on the `sonnet`
  alias; synthesizer on `opus`; scope and scribe on `haiku`.
- Fix application skips and reports anything that would change intended
  behavior, contradict the spec, or break the test run — see `applied.skipped`.
  Findings with `reversesDecision` are never handed to the fix applier.
- The Review phase ends with a separate, report-only **lean review**
  (ponytail): a `sonnet` pass over the same review diff that reports
  over-engineering ONLY (reinvented stdlib, one-caller abstractions, dead
  flexibility, shrinkable code — tags `delete`/`stdlib`/`native`/`yagni`/
  `shrink`). Its raw claims are independently verified through the same
  group-verifier step as every other review candidate, and any claim at a
  location the combined review already covers is dropped so the PR never
  shows an unvetted claim duplicating or contradicting a verified one. It is
  distinct from and non-overlapping with the combined correctness+cleanup
  review: it reviews HOW the change was built, never WHETHER an approved
  feature should exist, and never re-reports correctness/security/performance.
  Findings return in `ponytailReview` and are never routed to fix application,
  never escalated, and add no `AskUserQuestion` — run `/simplify` or
  `ponytail-review` afterward to act on them.
- The result file is written by a `haiku` scribe through a Bash heredoc (never
  the Write or Edit tool) and its reported size must equal the expected byte
  count (or that plus the heredoc's newline; one retry) — a truncated JSON
  file is never accepted.
- The review engine is duplicated in the plugin's `changes-review` workflow
  (Workflow scripts cannot import each other); that copy has no spec, no apply
  phase and no result file.
