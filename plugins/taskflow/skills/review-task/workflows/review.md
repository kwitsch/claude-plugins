# review-task stage script — usage reference

review-task's branch review in four stages: Simplify → Review → Organize →
Fix. Run by the `review-task` skill, which owns this reference. The script
never asks: it returns the findings whose fix would contradict the spec, and
the skill decides them and re-enters the script with `MODE: "fix"`.

## Invocation

**Primary:** `Workflow({ name: "taskflow:review-task-stages", args })` with
ONE structured `args` object — the script reads it as the global `args`.
The runtime may deliver the object as a JSON string; `decodeArgs` parses that
transparently. Never use `scriptPath`.

**Fallback** — only when the return is `stage: 'args'` and its `error` starts
with `args global is undefined`: Read `<PLUGIN_ROOT>/workflows/review-task-stages.workflow.js`,
prepend exactly one line after the `meta` block — `const args = { … }` as a
JSON object literal — and submit the whole text via the Workflow tool's
`script` parameter, without the tool-level `args` parameter. Any other
`stage: 'args'` error means a malformed payload: fix the call.

Agents: the review, organize, spec-check and rereview jobs run as
`taskflow:branch-reviewer` (read-only); the simplify job and the fixer are
inline prompts with all tools.

## Parameters (`args` object)

| Key         | Type   | Required   | Meaning                                                                                                                                                        |
| :---------- | :----- | :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MODE`      | string | yes        | `full`: all four stages. `fix`: only the Fix stage over `FINDINGS`                                                                                             |
| `BASE`      | string | yes        | Base ref; the branch diff is `git diff <BASE>...HEAD`                                                                                                          |
| `BRANCH`    | string | yes        | The current branch                                                                                                                                             |
| `LEVEL`     | string | yes        | code-review level: `medium`, `high`, `xhigh` or `max`                                                                                                          |
| `ENV`       | object | yes        | get-environment's result `{jevApi, advisor, graphmind, ponytail, coderabbit}` (booleans); `ponytail` and `coderabbit` add review jobs, `graphmind` adds a hint |
| `REPO_PATH` | string | yes        | Absolute repository root                                                                                                                                       |
| `SPEC_PATH` | string | no         | Absolute spec path; `""` (default) skips the spec check                                                                                                        |
| `FINDINGS`  | array  | `fix` only | Non-empty array of finding objects as a `full` run returned them in `specFindings`                                                                             |

Guards (`status: 'error', stage: 'args'`, before any agent): a missing
required key, `MODE` other than `full`/`fix`, `LEVEL` outside
`medium|high|xhigh|max`, `ENV` not an object, `REPO_PATH` not absolute,
`MODE: "fix"` without a non-empty `FINDINGS`.

## Finding object

`{id, sources, file, line, title, detail, fix, severity}`: `id` is `F1`,
`F2`, … (the numbering continues in later rounds, and in `fix` mode after
the highest `FINDINGS` id), `sources` the jobs that reported it, `severity`
one of `critical`, `major`, `minor`, `trivial`.

## Stages

| Stage      | Mode                                     | What it does                                                                                                                                                                                                                                                                        |
| :--------- | :--------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Simplify` | full                                     | One inline job runs the bundled `simplify` skill and commits `Simplify branch changes`. `failed` is recorded; the run goes on                                                                                                                                                       |
| `Review`   | full                                     | Read-only jobs in parallel: `code-review` at `LEVEL` (always), `ponytail-review` (`ENV.ponytail`), `coderabbit` (`ENV.coderabbit`; a rate limit, allowance or auth refusal is `skipped`). Findings only, no fixes, no credits                                                       |
| `Organize` | full, and the new findings of a rereview | Checks the tree is clean, merges duplicates, verifies, rates severity, dismisses false positives and findings outside the diff. With `SPEC_PATH`: spec-check jobs of 8 findings each, the first also checks the simplify commit; a failed job counts its findings as spec conflicts |
| `Fix`      | both                                     | At most 2 rounds of fixer (commit `Apply review fixes`) and rereview of `git diff <pre>..HEAD`. Leftovers go to `unresolved`                                                                                                                                                        |

## Result (exit contract)

One structured object; `status` is the discriminator. Consume only this return.

### `status: 'complete'`

| Field                  | Meaning                                                                                                                                          |
| :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                 | `full` or `fix`                                                                                                                                  |
| `simplify`             | `{status, commit, summary, error}`; `status` is `committed`, `unchanged`, `failed`, or `skipped` in `fix` mode                                   |
| `reviews`              | `[{source, status, reason, count}]`, one per job, including jobs `skipped` as not available                                                      |
| `organize`             | `{total, merged, dismissed, fixable, spec}`, counted over every Organize run                                                                     |
| `fix`                  | `{rounds, commits: ["<hash> <subject>"], fixed: [ids], unresolved: [{id, severity, file, line, title, reason}]}`                                 |
| `specFindings`         | `full` only: findings whose fix would contradict the spec, each with `decision` (the quoted spec decision) and `reason`. Never fixed by this run |
| `simplifySpecConflict` | `{commit, decision, reason}` when the simplify commit reverses a spec decision, else `null`                                                      |

In `fix` mode a spec conflict that a rereview finds goes to `fix.unresolved`
(no second decide round).

### `status: 'error'`

| `stage`    | Meaning                                                                                                                              | Action                                                          |
| :--------- | :----------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| `args`     | Invocation malformed, or `args global is undefined`                                                                                  | Fallback for `args global is undefined`; otherwise fix the call |
| `review`   | The code-review job failed or returned null twice, or a job left the working tree dirty (`error` lists the paths; nothing discarded) | Report it with the dirty paths; no final-check commit           |
| `organize` | The organize job returned null twice                                                                                                 | Report it                                                       |

## Behavior notes

- The script writes no files, reads no clock and uses no randomness;
  commits are its only side effect, never a reset, stash or checkout.
- A null result is retried once for the read-only jobs only. The simplify
  job and the fixer commit, so a retry would find the first attempt's commit
  in place and report nothing to commit: they are not retried, and a null
  result is recorded as `failed` (simplify) or as unresolved findings (fixer).
- Edits a failed simplify commit left in the tree are reported by the
  simplify job (`dirty`); the organize job's clean-tree check ignores exactly
  those paths, so a failed simplify commit does not end the run as a review
  job's stray edit. The fixer's `git add -A` commit takes them along.
- Models: `MODELS` in the script (simplifier, ponytail job, spec checker and
  fixer on `sonnet`; code reviewer, organizer and rereviewer on `opus`; the
  coderabbit job on `haiku`).
