---
name: build-task
description: >-
  End-to-end pipeline for a described task: design (explore, draft, review,
  spec) and delivery (plan, wave-parallel implementation in isolated
  worktrees with per-wave merge, combined review, fix application), both
  executed by prebuilt Workflow scripts shipped with this skill. Human
  checkpoints: open design questions and spec approval, via AskUserQuestion.
argument-hint: "[task-description]"
arguments: task_description
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Workflow", "AskUserQuestion", "ToolSearch"]
---

# build-task

Runs the feature-development pipeline (Design → Intent confirmation → Plan →
Implement → Review) for `$task_description`, with the heavy phases executed by
two dynamic workflows this plugin ships in its `workflows/` directory
(auto-discovered; they run as `/taskflow:design-to-spec` and
`/taskflow:spec-driven-delivery`). One usage reference per workflow —
parameters, exit contract, behavior — lives beside this file; read the
relevant one BEFORE each invocation:

- [references/design-to-spec.md](references/design-to-spec.md) —
  Explore → Draft design → Design review → Write spec → Spec review. Exits
  `complete` (spec written) or `user_input_required` (draft persisted + open
  user questions, resumable).
- [references/spec-driven-delivery.md](references/spec-driven-delivery.md)
  — Plan → wave-parallel Implement (every
  implementer in its own isolated worktree; each wave merged by a dedicated
  merger agent) → combined Review → fix application. Findings that would
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

## Session temp files

Every pipeline file is session-only, never a repository file:

- **Directory:** `<session scratchpad>/build-task/` when your system prompt
  provides a scratchpad directory (create the subfolder); when none is
  provided — or you are unsure dispatched workers can read that absolute
  path — run `mktemp -d -t build-task-XXXXXX` once and use that. Neither
  available → stop and report; every phase needs these files.
- **`<slug>`:** the work-branch name without its `<type>/` prefix when a work
  branch is already checked out; otherwise kebab-case from
  `$task_description`, ≤40 chars (then also used to cut the branch, step 1).
- **Files:** `draft-<slug>.md`, `spec-<slug>.md`, `plan-<slug>.md` — record
  and hand the workflows **absolute paths**, never inlined content. Always
  written in English by the designer/spec-writer/planner agents, regardless
  of `$task_description`'s language — these files are read only by other
  agents in the pipeline, never shown to the user directly.
- **Derived:** the design workflow additionally writes its session-scoped
  Explore-result cache to `draft-<slug>.explore-<key>.md` beside the draft
  (`<key>` is a hash of the task text) — same session-only rules, and never
  passed in as a parameter. Keep the temp directory OUTSIDE the repository
  working tree, or its untracked files invalidate that cache every round;
  both directory defaults above already are.
- **Never commit them.** Durable artifacts are the branch and its commits.
  State in commit/PR descriptions when design context matters.

## Workflow invocation rules (both scripts)

1. **Probe once:** `ToolSearch(query: "select:Workflow")`. Tool absent, or a
   script is rejected with a meta/API validation error → stop and report.
   This skill deliberately has **no Agent-engine fallback** — the workflows
   are the engine.
2. **Primary — invoke by name with `args`:** both scripts live in this
   plugin's root `workflows/` directory and are auto-discovered, so they run
   namespaced by the plugin name, displayed as `/taskflow:design-to-spec` and
   `/taskflow:spec-driven-delivery` (the prefix follows the manifest
   `name`). The `Workflow` tool's `name` parameter takes that identifier
   WITHOUT the leading `/` — `taskflow:design-to-spec` /
   `taskflow:spec-driven-delivery`; a leading `/` makes the tool report the
   name as not found (confirmed live). Pass the inputs as ONE structured
   `args` object — the script
   reads it as the `args` global; keys and return contract are documented in
   the per-workflow reference files linked above. Structured data, so task
   text and user answers need no string escaping. The runtime may deliver
   the object serialized as a JSON string — the templates' `decodeArgs`
   parses that transparently, so a `stage: 'args'` return always means a
   genuinely malformed payload: fix the call, never switch to the fallback
   for it.
3. **Fallback — ad-hoc script with prepended args:** only if the named
   invocation is unavailable (workflow not registered in this install), Read
   the template from `${CLAUDE_PLUGIN_ROOT}/workflows/<name>.workflow.js`
   (plugin-root substitution — the templates live at the plugin root, not
   inside this skill),
   prepend exactly one line after the `meta` block — `const args = { … }`
   as a JSON object literal — and send the whole text via the `script`
   parameter. NEVER pass the tool-level `args` parameter on an ad-hoc
   `{script}` call: the global arrives `undefined` there (docs scope `args`
   to saved workflows; twice-observed silent total failure). The templates'
   `decodeArgs` guard turns a wrong invocation into an immediate structured
   error. Note: the fallback still requires this plugin to be loaded —
   the scripts dispatch the plugin's `agents/` roles via namespaced
   `agentType` (`taskflow:<name>`), and an unknown type throws hard at
   dispatch.
4. **Consume only the structured return.** Never re-derive workflow state
   from transcript output; the return object is the contract. A return with
   `stage: 'args'` means the invocation itself was malformed — fix the call,
   do not debug the pipeline.

## Steps

1. **Branch.** `git status --porcelain` must be empty — stray state → stop
   and report. Determine `BASE_BRANCH` once: short name from
   `git symbolic-ref refs/remotes/origin/HEAD`, fallback `main`. If the
   current branch IS the base branch, cut and switch to `feature/<slug>`.
   Otherwise — including when resumed inside an existing worktree that
   already has an open PR/MR for its branch — stay on the current branch, do
   not cut a new one and do not switch elsewhere; the pipeline (and Ship's
   create-or-update, step 4) continues on it and updates that PR/MR. Either
   way, capture `BRANCH_NAME` = `git branch --show-current`.
2. **Design.** Run the design workflow (invocation rules above) with args
   `{TASK: $task_description, DRAFT_PATH, SPEC_PATH, RESUME: false,
USER_INPUT: ''}` (paths from the temp directory). Then by `status`:
   - `user_input_required` → one `AskUserQuestion` call covering the returned
     `questions` (their `options` verbatim as choices; free text arrives via
     "Other"; use `whyItMatters` as the question context). Re-run the
     workflow with args `RESUME: true`, the **same** `DRAFT_PATH`, and
     `USER_INPUT` = the answers as `[{id, answer}]`. Repeat this bullet
     until `complete` or `error` — new genuine questions after a resume are
     expected, not a failure.
   - `error` → surface `stage`, `error`, and `draftPath`, then stop.
   - `complete` with `specReviewed: false` → note it for the final report
     (step 5): the spec shipped without its completeness/ambiguity gate
     because the reviewer failed twice.
3. **Intent confirmation.** Read nothing aloud from memory: output the
   returned `keypoints` verbatim as your own plain-text message (the user has
   never seen the temp files), then `AskUserQuestion`: does this match their
   intent, proceed to implementation? Options: **Yes — proceed** / **No —
   needs changes** (specific corrections arrive via "Other"). "No" picked
   without detail → one clarifying `AskUserQuestion` round for what should
   change; never guess. With corrections in hand → re-run the design workflow
   with `RESUME = true` and `USER_INPUT` = the corrections (the workflow
   records them as binding USER DECISIONs and rewrites draft + spec), then
   re-ask this step from the new keypoints. Only after "Yes" does the spec
   count as **approved** — this is the pipeline's one human checkpoint on the
   design.
4. **Deliver.** Run the delivery workflow (invocation rules above) with args
   `{SPEC_PATH, PLAN_PATH, BRANCH_NAME, BASE_BRANCH}` (add `SHIP: false`
   only if the user asked not to open a PR/MR). The workflow ships on its
   own — push, PR/MR create-or-update, CI watch with bounded fix rounds; the
   returned `ship` object carries url and CI outcome. On an error return
   (`stage: 'Plan' | 'Implement' | 'Review'`): surface stage, reason, and the
   partial `results`, then stop — a failed task or wave-merge conflict is a
   hard stop; never retry the merge, never resolve a conflict, and never
   continue on a half-implemented plan (its `taskResults` name any abandoned
   worktrees/branches for manual cleanup).
5. **Escalations & report.** Terminal step.
   1. For each `escalatedToUser` finding (review fixes the workflow refused
      to auto-apply because they would reverse an approved-spec decision):
      group related findings into one `AskUserQuestion` (apply / skip).
      Apply the accepted ones yourself (Read → Edit; locate by content — line
      numbers are advisory), commit them as one commit per repo conventions
      (no co-author trailers), then `git push` — the PR/MR the workflow
      opened updates automatically. Never silently apply a decision-reversing
      fix.
   2. Report one short summary: wave layout, per-task results (id, model,
      status), review level + findings applied / skipped / escalated, the
      collected minor findings (implement per-task, review, design/spec),
      the commit hashes from `applied.commits` plus any escalation commit,
      and the `ship` outcome (PR/MR url, CI status; on `ci_failed`/`blocked`
      state plainly what the human must pick up). Merging the PR/MR is not
      this skill's job.
