---
name: solve
description: Single entry point for any coding task (change, feature, refactor, bug). Triages the task through the jev-api tools and routes it to the right track, loading the phase references it needs. Flags --headless (the decider agent answers every question) and --size=<S|M|L|XL>. Use when the user hands over a task to implement or fix.
---

# solve

Entry point and the only skill of this plugin. The phases are reference files next to this one; open one (Read) only when its row in the decision matrix applies. Do not start work before the triage below.

**jev-api first.** In this skill and all its references, a decision that fits options, a rating or yes/no is put to the jev-api tools before own reasoning; own reasoning only on low confidence or a failed call. The catalogue is at the end of [decide](decide.reference.md).

## 0. Arguments

Strip these flags from the task text before anything else; the rest is the task.

- `--headless`: no question goes to the user. See [Questions and --headless](#questions-and---headless).
- `--size=<value>`: `S`, `M`, `L` or `XL` (case-insensitive). That value is the size; the size question of the triage is skipped. Any other value counts as no `--size`: the triage rates the size.
- `--type=<value>`: `tiny`, `feature` or `bugfix` (case-insensitive). That value is the track; the track question of the triage is skipped and its confidence rule does not apply. Any other value counts as no `--type`: the triage picks the track. The track-specific rules below (worktree prefix, flow, size flow) apply as for a triaged track. A `--type=bugfix` that the root cause shows to be a feature still switches to the feature track, as in the bugfix track.

## Questions and --headless

Every question to the user goes through `AskUserQuestion`, never as plain text. This holds for this file and for every reference.

Before an `AskUserQuestion` that concerns a file (design, spec, plan, review notes), first print the file's content to the user as a summary in bullet points, with the file's full absolute path. Then ask for approval (approve, change, abort); on change, fix the file and ask again until approved. The summary is skipped with `--headless`: the decider reads the file itself. Each reference only says what its summary covers.

With `--headless`, `AskUserQuestion` is never called. Instead, for each question spawn the `decider` agent (`subagent_type: jev-solver:decider`, the plugin-namespaced name; model and effort by size: S, M and L run with the agent's own `opus`/`high`, XL with `model: fable`, `effort: high`, passed in the Agent call; continue the same agent with `SendMessage` for later questions) and brief it with:

- the question and the options that `AskUserQuestion` would have shown (label and description, the recommended one first),
- the task text, track, size, branch and worktree path,
- the absolute paths of `design.md`, `spec.md`, `plan.md` and `review.md` as far as they exist, and what the answer is used for.

It replies `answer:` (an option label, or free text if none fits) and `reason:`. Apply the answer as if the user had chosen it and note the decision in one line in the spec or plan. Approval gates (spec, discard) are answered by it too; discarding a branch, merging and other destructive or outward-facing steps beyond the normal flow are not taken headless: keep the branch.

## 1. Triage

Ask jev-api once, with the user's task text as `state`:

```yaml
mcp__jev-api__batch
questions:
  - type: choice
    instructions: Which kind of task is this?
    criteria:
      tiny: a very small change (rename, typo, one-line or config tweak, one small edit)
      feature: new behaviour, a feature, a refactor or anything needing design decisions
      bugfix: something is broken, a failing test, an error, unexpected behaviour
  - type: score
    instructions: How large is the work?
    criteria: [S: a few lines in one place, M: one component, L: several components, XL: cross-cutting or architectural]
```

Put the task-ambiguity question in the same call (`noul`: is the task text too ambiguous to start?; it counts only for the `feature` and `bugfix` tracks, and only a confident yes goes to the user via `AskUserQuestion`, headless: decider). With `--size`, leave out the score question; with `--type`, the track question; with `--type=tiny`, all questions (tiny needs neither size nor ambiguity check, so no call is made). With `--type=feature` or `bugfix` and a valid `--size`, only the ambiguity question remains. The score is fractional: round to the nearest level. Apply the confidence rule of [decide](decide.reference.md) to every answer; if it is low or the call fails (any error, no configuration), triage with your own reasoning using the same criteria and say so in one line.

## 2. Worktree and work branch

Always, for every track, right after triage and before any spec, plan, debugging or edit:

Follow [worktree](worktree.reference.md) (branch name `fix/<slug>` for the bugfix track, `feat/<slug>` for tiny and feature; never nest; baseline), then report branch and worktree path in one line and continue. The same slug names the scratchpad directory below.

## 3. Decision matrix

| Situation                                             | Reference                                     |
| ----------------------------------------------------- | --------------------------------------------- |
| Choosing between defined options, rating risk or size | [Decide](decide.reference.md)                 |
| Work starts, or starts outside a worktree             | [Worktree](worktree.reference.md)             |
| Feature, size L or XL, no approved design yet         | [Design](design.reference.md)                 |
| Feature, size XL, approved design, no spec yet        | [Spec](spec.reference.md)                     |
| Feature, size M or larger, no approved plan yet       | [Plan](plan.reference.md)                     |
| A plan (or a tiny change) is to be carried out        | [Execute](execute.reference.md)               |
| Writing any production code                           | [Test first](tdd.reference.md)                |
| Bug, failing test, error, unexpected behaviour        | [Debug](debug.reference.md)                   |
| Before any claim of done, fixed or passing            | [Verify](verify.reference.md)                 |
| A change, phase or finished task needs review         | [Request review](request-review.reference.md) |
| Review feedback arrived (reviewer, user, PR)          | [Receive review](receive-review.reference.md) |
| First commit, every push, merge-ready at the end      | [Pull request](pr.reference.md)               |
| Implementation and review done                        | [Finish](finish.reference.md)                 |

## 4. Tracks

Below, a name in brackets is the matrix row to follow.

### tiny

Implement directly. Then [Verify](verify.reference.md) and a light review: read your own diff once (`git diff`), nothing more. Then [Finish](finish.reference.md). No spec, no plan.

### feature

Flow by size, each "confirm" is an `AskUserQuestion` after a bullet-point summary of the file (headless: decider):

| Size | Flow                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------- |
| S    | implement directly                                                                                                        |
| M    | [Plan](plan.reference.md), confirm, implement                                                                             |
| L    | [Design](design.reference.md), confirm, [Plan](plan.reference.md), confirm, implement                                     |
| XL   | [Design](design.reference.md), confirm, [Spec](spec.reference.md), confirm, [Plan](plan.reference.md), confirm, implement |

Then:

1. Implement with [Execute](execute.reference.md) (with [Test first](tdd.reference.md) for code); on S there is no plan, so execute works from the task text.
2. [Verify](verify.reference.md).
3. `/simplify` once on the finished work (any size), then [Verify](verify.reference.md) again.
4. [Request review](request-review.reference.md), depth by size (L and XL: the per-phase reviews and, on XL, the design and spec reviews; the final diff is covered by the `/code-review` of the section below):

| Size | Review                                                            |
| ---- | ----------------------------------------------------------------- |
| S    | read your own diff                                                |
| M    | one review of the final diff                                      |
| L    | a review after each plan phase, plus one of the final diff        |
| XL   | additionally a review of the design and of the spec before coding |

Findings are handled with [Receive review](receive-review.reference.md). Then the final `/code-review` and [Finish](finish.reference.md).

### bugfix

On its `fix/` work branch (step 2): [Debug](debug.reference.md) (root cause, failing test, one fix), [Verify](verify.reference.md), [Request review](request-review.reference.md) (S, M: read your own diff; L and above: one review of the final diff; findings via [Receive review](receive-review.reference.md)), the final `/code-review`, [Finish](finish.reference.md). No spec or plan, unless the root cause shows the fix is really a feature (`noul` via [decide](decide.reference.md)): then switch to the feature track and say so.

### Final code review (feature and bugfix, never tiny)

After the track's own reviews and before [Finish](finish.reference.md), run `/code-review <level> --fix` on the branch, the level taken from the size: S `low`, M `medium`, L `high`, XL `xhigh`. Never `max` unless the user asks. Re-run [Verify](verify.reference.md) after it applied fixes.

### Pull request

After the first commit on every track: push and open a draft PR; after every push: update the PR description ([Pull request](pr.reference.md); no question about it). Commit and push per step or phase, not only at the end.

### Done means merge-ready

The skill ends only when every change is committed and pushed on the work branch, the PR description is current, all merge conflicts with the base are resolved, the checks are green and the PR is merge-ready ([Finish](finish.reference.md) with [Pull request](pr.reference.md) does this). Report the PR URL.

## Documents

Design, spec, plan and review notes live in the session scratchpad directory (named in the system prompt) under `jev-solver/<task-slug>/` (`design.md`, `spec.md`, `plan.md`, `review.md`), never in the repository. Name them with their full absolute path when you mention them to the user (and to the decider).

## Code exploration

In a graphmind project (`graphmind which` exits 0) start every exploration with `/gm` (`/gm-fn` for reading a symbol, `/gm-impact` for blast radius); grep only for string literals and config. Otherwise use the normal tools. Save decisions and conventions found along the way with `graphmind memory add` (project scope).
