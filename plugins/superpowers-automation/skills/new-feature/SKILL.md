---
name: new-feature
description: Drive a new feature end-to-end through the superpowers pipeline from a one-line description — create a feature branch, then brainstorm, review the spec, write the plan, review the plan, and implement. Use when starting a new feature, fix, or chore that should run the full spec->plan->implement workflow with advisor review at the spec and plan stages.
argument-hint: "<feature description>"
arguments: feature_description
---

# new-feature

Thin orchestrator. Drives the full superpowers pipeline for one feature, calling
`file-advisor-improver` to revise the spec and the plan between stages. Runs inline
because it invokes sub-skills — do NOT fork it.

`$feature_description` (also `$ARGUMENTS`) is the feature description. If it is empty,
stop and ask the user for one before doing anything else.

Create one TodoWrite item per step below and work them in order.

## Steps

1. **Branch name.** Derive a branch name from `$feature_description`: lowercase it,
   replace every run of non-alphanumeric characters with a single `-`, trim leading
   and trailing `-`, cap to ~50 characters, and prefix `feature/`. Example:
   "Add CSV export to reports" -> `feature/add-csv-export-to-reports`.

2. **Create the branch.** If `branch-management:new-branch` appears in your available
   skills, invoke it (Skill tool) with the branch name from step 1. Otherwise fall
   back to git:

   ```bash
   default="$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')"
   default="${default:-main}"
   git checkout "$default" && git pull --ff-only && git checkout -b "<branch>"
   ```

3. **Brainstorm.** Invoke `superpowers:brainstorming`, passing `$feature_description`.
   It writes the spec under `docs/superpowers/specs/`.
   **SUPPRESS its auto-handoff:** brainstorming's terminal step invokes
   `superpowers:writing-plans` itself. Do NOT let it. Once the spec is written (and
   committed), STOP the brainstorming chain and return here — `new-feature` runs step 4
   next, then invokes writing-plans itself in step 5.

4. **Improve the spec.** Invoke `superpowers-automation:file-advisor-improver` with the
   spec file path — read it from brainstorming's "saved to `<path>`" line; fallback: the
   newest file under `docs/superpowers/specs/`. It revises the spec in place. (Note: the
   "newest file" fallback is racy under parallel runs; prefer the reported path.)

5. **Write the plan.** Invoke `superpowers:writing-plans` on the spec path. It writes
   the plan under `docs/superpowers/plans/`.
   **SUPPRESS its handoff:** writing-plans ends by asking "which approach? 1.
   Subagent-Driven 2. Inline", and the plans hook may inject "invoke
   subagent-driven-development". Do NOT answer that question or act on that nudge yet.
   Once the plan is written, return here — `new-feature` runs step 6 next.

6. **Improve the plan.** Invoke `superpowers-automation:file-advisor-improver` with the
   plan file path — from writing-plans' "saved to `<path>`" line; fallback: the newest
   file under `docs/superpowers/plans/`. It revises the plan in place.

7. **Implement.** Invoke `superpowers:subagent-driven-development` to implement the
   revised plan task-by-task.
