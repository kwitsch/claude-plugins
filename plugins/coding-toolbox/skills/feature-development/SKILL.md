---
name: feature-development
description: >-
  Runs fresh-work's design-path pipeline (Design, Intent confirmation, Plan,
  Implement, Review) for feature and refactor work. Invoked by fresh-work
  after it classifies work as feature or refactor (both dispatch here — the
  two share an identical pipeline) and cuts the work branch — assumes a work
  branch is already checked out.
argument-hint: "[work-description]"
arguments: work_description
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Agent", "Workflow", "ToolSearch", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop"]
---

# feature-development

Plugin root: !`echo "$CLAUDE_PLUGIN_ROOT"`

Runs fresh-work's design-path pipeline for both `feature`- and
`refactor`-classified work (the two share an identical pipeline; only the
branch prefix differs, decided by `fresh-work` before this skill is
invoked). Invoked by `fresh-work` after it classifies work and cuts the
branch; assumes a work branch is already checked out. Runs inline because it
invokes Workflow/sub-agents directly — do NOT fork it.

`$work_description` is the work description, passed through unchanged from
`fresh-work`.

Read `<plugin root above>/skills/feature-development/references/dispatch-shared.md`
for the shared `AskUserQuestion` banner and Task-list core (shared verbatim
with `fresh-work`, kept in one place).

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

See `references/dispatch-shared.md` (already read above) for the core
Task-list rules. Specific to this skill:

**Step numbering.** If, when this skill starts, a caller skill's task is
still `in_progress` (e.g. `fresh-work`'s `Step 4: Dispatch`), nest every step
this skill creates under that task's number by appending `.1`, `.2`, … in
order — `Step 4.1: Design` … `Step 4.5: Review` — instead of starting an
independent top-level `Step 1`, which would collide with the caller's own
step numbers by reusing the same labels for unrelated work. The caller's
`Step 4` task itself **stays `in_progress` throughout** — per
`references/dispatch-shared.md`'s scoping rule, that's expected (it
represents "waiting on this skill"), not a second entry competing for the
same "one in_progress" slot as this skill's own `Step 4.1`…`Step 4.5`, which
belong to a separate segment of the shared ledger. Never mark the caller's
`Step 4` `completed` before this skill actually returns. If there is no such
caller step (standalone invocation), use independent top-level `Step 1:
Design` … `Step 5: Review` as normal. Up front create only the Design step in
whichever form applies; after Design create the remaining steps the same
way.

Implement's own per-wave nested dispatch (`Step N.1…N.x`,
`references/implementing.md`) nests one level further under whichever number
this skill's own Implement step actually has — `Step 4.1…4.x` standalone, or
e.g. `Step 4.4.1…4.4.x` when this skill itself is nested under caller step 4
— same append-a-number rule, applied recursively.

**Step-start reporting example:**

> Starting step 1: Design.

(or, nested: "Starting step 4.1: Design.") This announcement never
substitutes for a step's own required output — e.g. step 2's Keypoints
presentation below is a separate, mandatory message, not satisfied by this
line.

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
