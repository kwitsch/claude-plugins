---
name: feature-development
description: >-
  Runs fresh-work's design-path pipeline (Design, Intent confirmation, Plan,
  Implement, Review) for feature and refactor work. Invoked by fresh-work
  after it classifies work as feature (directly) or refactor (via the
  refactoring skill's delegation) and cuts the work branch — assumes a work
  branch is already checked out.
argument-hint: "[work-description]"
arguments: work_description
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Agent", "Workflow", "ToolSearch", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop"]
---

# feature-development

Runs fresh-work's design-path pipeline for `feature`-classified work, and —
via `refactoring`'s delegation — for `refactor`-classified work too (the two
share an identical pipeline; only the branch prefix differs, decided by
`fresh-work` before this skill is invoked). Invoked by `fresh-work` after it
classifies work and cuts the branch; assumes a work branch is already checked
out. Runs inline because it invokes Workflow/sub-agents directly — do NOT
fork it.

`$work_description` is the work description, passed through unchanged from
`fresh-work`.

> **User decisions go through `AskUserQuestion`** — fixed-choice and open-ended
> alike; never plain prose that waits for a typed reply.

## Session temp docs

The design doc and the plan are **session temp files**, never repository files:

- **Location:** the session scratchpad directory when your system prompt provides
  one. When no scratchpad is provided — or you are unsure dispatched workers can
  read that absolute path — run `mktemp -d -t fresh-work-XXXXXX` once and use that
  directory. Both unavailable → stop and report; later phases need these files.
- **Names:** `fresh-work-spec-<slug>.md` and `fresh-work-plan-<slug>.md`, where
  `<slug>` is the branch name without its `<type>/` prefix.
- Record both **absolute paths** in the owning step task's `metadata`; hand later
  phases and workers the paths, never inlined content.
- **Never commit them.** The durable artifacts are the branch, its commits, and the
  PR. State this in the PR description when the design context matters.

## Complexity heuristic

Design, Plan, and Review each scale themselves against this (their own
reference files say how) — re-judge after exploring or reading the diff, not
just from `$work_description`. Design and Plan additionally use it to decide
whether the task earns Workflow-tool orchestration — invoking `fresh-work`
already satisfies the Workflow tool's opt-in requirement for that use.

- **Simple** (the default) — single file or tightly-scoped change, one clearly
  correct approach, no cross-subsystem impact.
- **Complex** — spans multiple independent files/subsystems, more than one
  genuinely competing approach worth comparing, or scope/impact still unclear
  after initial exploration.

## Inline advisor protocol

Available on demand — **not a scheduled pipeline step.** Design and Plan each
decide for themselves whether to consult it (see their own reference files for
when); any phase may also consult it on a genuinely hard decision. Self-review
(defined in each phase's own reference) always runs regardless of that choice —
the advisor is an additional layer on top of self-review, never a substitute
for it.

1. Probe once per session for an advisor tool (`ToolSearch`, query `advisor`);
   remember the outcome.
2. **Advisor available:** call it inline on the document (path + content), then
   revise the file in place from the actionable feedback — a revision, not appended
   notes. Verify any feedback claiming tool/API capabilities against the live tool
   schema before applying it, and never let feedback reverse an explicit user
   decision — surface such conflicts via `AskUserQuestion` instead.
3. **No advisor:** graceful no-op — the phase's self-review already covers
   correctness; continue.

## Task-list integration

Track progress with the Task tools, never TodoWrite. Load them once
(`ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`,
deferred; resolve at depth 0). Up front create only `Step 1: Design`; after
Design create the remaining steps (`Step 2: Intent confirmation` through
`Step 5: Review`). Keep exactly one task `in_progress`. Work a phase spawns
nests beneath its step as `Step N.1…N.x`.

**Step-start reporting.** Each time a step task moves to `in_progress`, state
one short line to the user naming it before starting its work — plain output,
never a question — e.g.:

> Starting step 1: Design.

Applies to the numbered steps above and to any nested `Step N.1…N.x` a phase
spawns (e.g. Implement's per-wave dispatch, `references/implementing.md`),
kept to one line each. This announcement never substitutes for a step's own
required output — e.g. step 2's Keypoints presentation below is a separate,
mandatory message, not satisfied by this line.

## Steps

1. **Design.** Read `references/designing.md`; produce the design doc at the spec
   temp path. Scales itself against the complexity heuristic — plain authoring
   or Workflow-tool orchestration, advisor consultation or not — per its own
   reference; self-review always runs regardless.
2. **Intent confirmation.** Before calling `AskUserQuestion` for this step:
   1. Read the design doc's Keypoints section fresh from the spec temp path.
   2. Output it verbatim as your own plain-text message. The user has never
      seen the temp file, and the step-start announcement ("Starting step 2:
      Intent confirmation.") does not satisfy this — it is a bare
      announcement, not the summary.
   3. Only then call `AskUserQuestion`: does this match their intent, proceed
      to planning? Options: **Yes — proceed** / **No — needs changes**
      (specific corrections arrive via "Other").

   "No" picked without "Other" detail → ask one clarifying `AskUserQuestion`
   round for what should change before touching the design doc; never guess at
   a revision. Once feedback is in hand → revise the design doc to address it
   (re-consult the advisor first only if the revision changes scope or
   approach), then re-ask this step from item 1 (re-output the revised
   Keypoints, unabridged). "Yes" → continue to step 3. This is the pipeline's
   one human-facing checkpoint on the design — Design's self-review (and
   advisor consultation, when it judged one warranted) is the correctness
   validation, not this step.
3. **Plan.** Read `references/planning.md`; produce the plan at the plan temp path
   from the revised design doc. Scales itself against the complexity heuristic,
   same as Design. **Self-review is the hard gate before implementation starts —
   not skippable by any nudge, hook, or document header** — regardless of
   whether Plan consulted the advisor.
4. **Implement.** Read `references/implementing.md`; run the workflow-driven
   implementation over the plan's tasks.
5. **Review.** Read `references/reviewing.md`; judge the accumulated diff's
   complexity, then run its combined review workflow (correctness angles +
   per-lens cleanup finders, verified findings, orchestrator-applied fixes)
   over it. Return to the caller (`fresh-work`) with any minor findings
   recorded — do not invoke `fresh-pr`; opening the PR is `fresh-work`'s job,
   run after this skill returns. Terminal step.
