---
name: build-task
description: >-
  End-to-end pipeline for a described task: design (explore, draft, review,
  spec) and delivery (plan, wave-parallel implementation, combined review,
  fix application), both executed by prebuilt Workflow scripts shipped with this skill. Human
  checkpoints: open design questions and spec approval, via AskUserQuestion.
argument-hint: "[--skip-branch-check] [task-description]"
arguments: task_description
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Workflow", "AskUserQuestion", "ToolSearch", "EnterWorktree"]
---

# build-task

Runs the feature-development pipeline (Design → Intent confirmation → Plan →
Implement → Review) for `$task_description`, with the heavy phases executed by
Workflow scripts. The design pipeline is three single-phase scripts shipped in
this skill's `workflows/` directory — explore, design, spec — run by
`scriptPath` (they are not plugin workflows). Delivery is the plugin's
`spec-driven-delivery` workflow (auto-discovered in the plugin's `workflows/`
directory, run as `/taskflow:spec-driven-delivery`). One usage reference per
script — parameters, exit contract, behavior — lives beside this file; read
the relevant one BEFORE each invocation:

- [workflows/explore.md](workflows/explore.md) — scout → read-only
  explorers → exploration reports written to `EXPLORE_PATH`. Exits `complete`
  (path + explored subsystems) or `error`.
- [workflows/design.md](workflows/design.md) — Draft design → Design review
  → one revision round. Exits `complete` (draft decision-complete) or
  `user_input_required` (draft persisted + open user questions, resumable).
- [workflows/spec.md](workflows/spec.md) — Write spec → Spec review → one
  fix round. Exits `complete` (spec written) or `error`.
- [references/spec-driven-delivery.md](references/spec-driven-delivery.md)
  — Plan → wave-parallel Implement (worktree/merge rules per wave size are in
  the reference) → combined Review → fix application. Findings that would
  reverse an approved-spec decision come back unapplied as `escalatedToUser`.

Runs inline because it invokes the Workflow tool directly — do NOT fork it.
**No Task-list integration**: the long-running work lives inside the
workflows, whose own `phase()`/`log()` output is the progress surface. This
skill only announces its steps as single plain-text lines ("Starting step N:
…") — announcements are never questions and never substitute for a step's own
required output (step 3's Keypoints presentation is a separate, mandatory
message).

> **User decisions go through `AskUserQuestion`** — fixed-choice and
> open-ended alike; never plain prose that waits for a typed reply.

`$task_description` may optionally start with `--skip-branch-check` (a bare
boolean flag, no value) — parse and strip it before anything else; whatever
remains (trimmed) is the actual task text used everywhere `$task_description`
is referenced below. When present it makes step 1 trust the
already-checked-out work branch and skip its clean-tree check and worktree creation
(see step 1). Callers that have already established the correct, clean work
branch — notably `dispatch-task`, which always passes it — use this to avoid
a redundant check.

## Plugin context

Plugin root: ${CLAUDE_PLUGIN_ROOT}

Capture the `Plugin root:` value above and pass it to the delivery workflow
as `PLUGIN_ROOT` (step 4) — agents cannot read `$CLAUDE_PLUGIN_ROOT` inside a
Bash-tool subprocess, so the workflow builds the absolute
`bin/ship-ensure-mergeable.sh` path from it and hands it to shipper. This is
a plain **pre-injection text substitution** (the same mechanism as
`${CLAUDE_SKILL_DIR}`, per `.claude/rules/script-authoring.md`) — resolved
before this skill body is even sent to you, no shell command runs. **Do NOT
change this back to a load-time shell injection** (the exclamation-prefixed
backtick form that ran `echo` on this variable at load time — never write
that two-character sequence anywhere in this file, even as a quoted example:
the load-time preprocessor does not respect markdown code spans, so a prose
mention executes exactly like the real thing) — see `CLAUDE.md`'s
"Fixed 2026-08-22" section for
why that broke every `dispatch-task`-launched run. Empty (loaded outside any
plugin context, or an unresolved literal `${CLAUDE_PLUGIN_ROOT}` token) →
pass it through unchanged; shipper degrades to `mergeState: 'unknown'` and
skips remediation (the pre-fix loop still runs).

Skill dir: ${CLAUDE_SKILL_DIR}

Capture the `Skill dir:` value above too: `SKILL_DIR` = `<Skill dir>`
(absolute). The design-pipeline scripts are `<SKILL_DIR>/workflows/explore.workflow.js`,
`<SKILL_DIR>/workflows/design.workflow.js` and `<SKILL_DIR>/workflows/spec.workflow.js`. Same
pre-injection substitution and the same rule as the plugin root above: no
load-time shell injection, never the exclamation-backtick sequence.

## Session temp files

Every pipeline file is session-only, never a repository file:

- **Directory:** `<session scratchpad>/build-task/` when your system prompt
  provides a scratchpad directory (create the subfolder); when none is
  provided — or you are unsure dispatched workers can read that absolute
  path — run `mktemp -d -t build-task-XXXXXX` once and use that. Neither
  available → stop and report; every phase needs these files.
- **`<slug>`:** the work-branch name without its `<type>/` prefix when a work
  branch is already checked out; otherwise kebab-case from
  `$task_description`, ≤40 chars (then also names the worktree directory and
  its `feature/<slug>` branch, step 1).
- **Files:** `explore-<slug>.md` (`EXPLORE_PATH`), `draft-<slug>.md`
  (`DRAFT_PATH`), `spec-<slug>.md` (`SPEC_PATH`), `plan-<slug>.md`
  (`PLAN_PATH`) — record and hand the workflows **absolute paths**, never
  inlined content. Always written in English by the explore scribe and the
  designer/spec-writer/planner agents, regardless of `$task_description`'s
  language — these files are read only by other agents in the pipeline,
  never shown to the user directly. The skill never Reads these files; it
  passes their absolute paths to the workflows and uses only the structured
  returns.
- **Never commit them.** Durable artifacts are the branch and its commits.
  State in commit/PR descriptions when design context matters.

## Workflow invocation rules (all scripts)

1. **Probe once:** `ToolSearch(query: "select:Workflow")`. Tool absent, or a
   script is rejected with a meta/API validation error → stop and report.
   This skill deliberately has **no Agent-engine fallback** — the workflows
   are the engine.
2. **Design pipeline — invoke by `scriptPath` with `args`:**
   `Workflow({scriptPath: "<SKILL_DIR>/workflows/<name>.workflow.js", args})` with
   `<name>` = `explore`, `design` or `spec`, and ONE structured `args` object
   — the script reads it as the `args` global; keys and return contract are in
   the per-script reference files linked above. Structured data, so task text
   and user answers need no string escaping. The runtime may deliver the
   object serialized as a JSON string — the scripts' `decodeArgs` parses that
   transparently.
3. **Delivery — invoke by name with `args`:** `spec-driven-delivery` lives in
   this plugin's root `workflows/` directory and is auto-discovered, so it
   runs namespaced by the plugin name, displayed as
   `/taskflow:spec-driven-delivery` (the prefix follows the manifest `name`).
   The `Workflow` tool's `name` parameter takes that identifier WITHOUT the
   leading `/` — `taskflow:spec-driven-delivery`; a leading `/` makes the tool
   report the name as not found (confirmed live). Pass the inputs as ONE
   structured `args` object.
4. **Fallback — ad-hoc script with prepended args:** when a return is
   `stage: 'args'` and its `error` starts with `args global is undefined`, or
   the named delivery workflow is not registered in this install: Read the
   script — `<SKILL_DIR>/workflows/<name>.workflow.js`, or
   `${CLAUDE_PLUGIN_ROOT}/workflows/spec-driven-delivery.workflow.js` for
   delivery — prepend exactly one line after the `meta` block —
   `const args = { … }` as a JSON object literal — and send the whole text via
   the `script` parameter. NEVER pass the tool-level `args` parameter on an
   ad-hoc `{script}` call: the global arrives `undefined` there. Once the
   undefined-args fallback triggered, use it for every later design-pipeline
   call in this invocation. Any other `stage: 'args'` error means a genuinely
   malformed payload — fix the call, never switch to the fallback for it.
   Note: the delivery fallback still requires this plugin to be loaded — the
   delivery script dispatches the plugin's `agents/` roles via namespaced
   `agentType` (`taskflow:<name>`), and an unknown type throws hard at
   dispatch.
5. **Consume only the structured return.** Never re-derive workflow state
   from transcript output; the return object is the contract. A return with
   `stage: 'args'` means the invocation itself was malformed — fix the call
   (or apply rule 4 for `args global is undefined`), do not debug the
   pipeline.

## Steps

1. **Branch.** When `--skip-branch-check` was passed (flag paragraph above),
   skip the `git status --porcelain` clean check and the
   worktree creation/switch logic entirely — trust that the correct
   work branch is already checked out. Still determine `BASE_BRANCH` (short
   name from `git symbolic-ref refs/remotes/origin/HEAD`, fallback `main`) and
   capture `BRANCH_NAME`/`REPO_PATH` as in the last sentence below.
   Otherwise (flag absent): `git status --porcelain` must be empty — stray
   state → stop and report. Determine `BASE_BRANCH` once as above. If the
   current branch IS the base branch, do not cut a branch in this checkout;
   create a worktree and move the session into it: (a) Before creating
   it, `git -C "<root>" check-ignore -q ".claude/worktrees/<slug>"` must
   exit 0, where `<root>` is the path after the `worktree` keyword on the
   first line of `git worktree list --porcelain` (the main worktree —
   correct for submodules and separate git dirs too) — otherwise the
   worktree would show up as untracked in the main checkout: stop and
   report, asking the user to add `.claude/worktrees/` to the repo's
   `.gitignore`. (b) `ToolSearch(query: "select:EnterWorktree")`, then
   `EnterWorktree` with `name: "<slug>"` — never with `path` on a worktree
   made by hand: `ExitWorktree` cannot remove a worktree entered by
   `path`, so the user could not clean it up after the run. It branches
   from `worktree.baseRef`'s base (default: `origin/<BASE_BRANCH>`). Tool
   absent or the call rejected (e.g. the worktree already exists) → stop
   and report. (c) Rename its `worktree-<slug>` branch:
   `git branch -m "feature/<slug>"`; non-zero exit (branch already exists)
   → stop and report, naming the worktree path for manual cleanup. The new
   worktree has no gitignored files (`node_modules`, `.env`, build
   output): if the project's docs (root `CLAUDE.md`/README) name an install
   or setup command, run it there before step 2. The session stays in this
   worktree for the rest of the run; never call `ExitWorktree` — the user
   leaves it with `ExitWorktree` after the PR/MR is merged.
   Otherwise — including when resumed inside an existing worktree that
   already has an open PR/MR for its branch — stay on the current branch, do
   not cut a new one and do not switch elsewhere; the pipeline (and Ship's
   create-or-update, step 4) continues on it and updates that PR/MR. Either
   way — after the switch when (b) ran — capture `BRANCH_NAME` =
   `git branch --show-current` and `REPO_PATH` =
   `git rev-parse --show-toplevel` (absolute repo root) — also on the
   `--skip-branch-check` path (`dispatch-task` always passes it): the explore
   script and the delivery workflow (steps 2 and 4) fail loud with
   `stage:'args'` on an empty `REPO_PATH` whenever graphmind is available.
2. **Design.** Four sub-steps; paths come from the temp directory above.
   1. **Graphmind probe.** Probe once whether graphmind is usable for this
      checkout: (a) `ToolSearch(query: "select:mcp__graphmind__gm_search")` —
      the tool's schema present in the result; and (b) run `graphmind which`
      via Bash — exit 0 (it prints the registered project slug; exit 1 when
      the checkout is not registered). Both ⇒ `GRAPHMIND_AVAILABLE = true`; no
      schema, `graphmind` not found, or exit 1 ⇒ `false`. Compute this once
      per `build-task` invocation and reuse the same value for the explore
      call and step 4 (a value held in this running skill — never written to
      a file; no cross-run caching).
   2. **Explore.** Run the explore script (invocation rules above) with args
      `{TASK: $task_description, EXPLORE_PATH, GRAPHMIND_AVAILABLE, REPO_PATH}`
      (`REPO_PATH` from step 1). `error` → surface `stage` and `error`, then
      stop. `complete` → keep `explorePath` and `subsystems`. Explore runs
      once per invocation; resumes and corrections never re-run it.
   3. **Size** (once per invocation; reused on every resume and correction
      re-run). `ToolSearch(query: "select:mcp__jev-api__score")`. Schema
      returned → call `mcp__jev-api__score` with `state` = the task text plus
      one line per returned subsystem (`<name> — <focus>`),
      `instructions: "How large is the work?"` and `criteria` = these four
      strings, in this order:
      - `S: a few lines in one place`
      - `M: one component`
      - `L: several functionalities, modules or subprojects`
      - `XL: cross-cutting or architectural`

      Accept when the result parses as JSON with `type: "score"`, a numeric
      `score` and `confidence >= 0.6`: `SIZE` = `["S","M","L","XL"][Math.round(score)]`
      (index clamped to 0..3); print one line `Size: <X> (jev-api, confidence <c>)`.
      Otherwise — no schema, a result string starting with `score:`,
      unparsable, or lower confidence — decide `SIZE` yourself against the
      same four criteria from the same inputs and print one line
      `Size: <X> (own reasoning: <reason>)`. No retry loop; sizing never
      fails the run. `SIZE` only picks the designer model.
   4. **Design.** Run the design script with args
      `{TASK: $task_description, EXPLORE_PATH, DRAFT_PATH, SKILL_DIR, SIZE, RESUME: false, USER_INPUT: ''}`.
      Then by `status`:
      - `user_input_required` → one `AskUserQuestion` call covering the
        returned `questions` (their `options` verbatim as choices; free text
        arrives via "Other"; use `whyItMatters` as the question context).
        Re-run the design script with `RESUME: true`, the **same**
        `EXPLORE_PATH`, `DRAFT_PATH`, `SKILL_DIR` and `SIZE`, and
        `USER_INPUT` = the answers as `[{id, answer}]` (a JSON value, never
        `[object Object]`). Repeat this bullet until `complete` or `error` —
        new genuine questions after a resume are expected, not a failure.
      - `error` → surface `stage`, `error`, and `draftPath`, then stop.
      - `complete` → keep `keypoints` and the design `minorFindings`.
   5. **Spec.** Run the spec script with args `{DRAFT_PATH, SPEC_PATH}`.
      `error` → surface `stage`, `error`, and `draftPath`, then stop.
      `complete` with `specReviewed: false` → note it for the final report
      (step 5): the spec shipped without its completeness/ambiguity gate
      because the reviewer failed twice. Keep the spec `minorFindings`.
3. **Intent confirmation.** Read nothing aloud from memory: output the
   `keypoints` from the last design return verbatim as your own plain-text
   message (the user has never seen the temp files), then `AskUserQuestion`:
   does this match their intent, proceed to implementation? Options: **Yes —
   proceed** / **No — needs changes** (specific corrections arrive via
   "Other"). "No" picked without detail → one clarifying `AskUserQuestion`
   round for what should change; never guess. With corrections in hand →
   re-run step 2.4 (design script) with `RESUME: true`, `USER_INPUT` = the
   corrections, and the same `EXPLORE_PATH`, `DRAFT_PATH`, `SKILL_DIR` and
   `SIZE` (the script records the corrections as binding USER DECISIONs and
   rewrites the draft; handle its return as in step 2.4), then step 2.5 (spec
   script), then re-ask this step from the new keypoints. Explore and Size are
   not re-run. Only after "Yes" does the spec count as **approved** — this is
   the pipeline's one human checkpoint on the design.
4. **Deliver.** Run the delivery workflow (invocation rules above) with args
   `{SPEC_PATH, PLAN_PATH, BRANCH_NAME, BASE_BRANCH, PLUGIN_ROOT, SCRATCH_DIR, GRAPHMIND_AVAILABLE, REPO_PATH}`
   (`SCRATCH_DIR` is the same session-temp directory from "Session temp files"
   above, trailing slash included — the delivery workflow's pr-author/
   implementer agents write their own scratch files there for
   shipper/reviewer to read back; add `SHIP: false`
   only if the user asked not to open a PR/MR). The workflow ships on its
   own — push, PR/MR create-or-update, CI watch with bounded fix rounds; the
   returned `ship` object carries url and CI outcome. On an error return
   (`stage: 'Plan' | 'Implement' | 'Review'`): surface stage, reason, and the
   partial `results`, then stop — a failed task or wave-merge conflict is a
   hard stop; never retry the merge, never resolve a conflict, and never
   continue on a half-implemented plan (its `taskResults` name any abandoned
   worktrees/branches or left-behind commits for manual cleanup).
5. **Escalations & report.** Terminal step.
   1. For each `escalatedToUser` finding (review fixes the workflow refused
      to auto-apply because they would reverse an approved-spec decision):
      group related findings into one `AskUserQuestion` (apply / skip).
      Apply the accepted ones yourself (Read → Edit; locate by content — line
      numbers are advisory), commit them as one commit per repo conventions
      (no co-author trailers), then `git push` — the PR/MR the workflow
      opened updates automatically. Never silently apply a decision-reversing
      fix.
   2. Report one short summary: the `Size:` line, wave layout, per-task
      results (id, model, status), review level + findings applied / skipped
      / escalated, the lean-review (`ponytailReview`) over-engineering
      findings (report-only, not applied), the collected minor findings
      (implement per-task, review, design — from the last design return —
      and spec — from the last spec return), the commit hashes from
      `applied.commits` plus any escalation commit, and the `ship` outcome
      (PR/MR url, CI status; on `ci_failed`/`blocked` state plainly what the
      human must pick up). Merging the PR/MR is not this skill's job.
