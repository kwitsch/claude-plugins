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

**Track progress as tasks.** Before step 1, create one task per step below (steps
1–7) with `TaskCreate` (each starts `pending`). As the pipeline runs, `TaskUpdate`
the active step to `in_progress` on entry and to `completed` the moment it finishes
— keep exactly one task `in_progress` at a time — so the user always sees which
stage of the flow is active. Use the Task tools (`TaskCreate`/`TaskUpdate`), not
`TodoWrite`: they are the session default since Claude Code v2.1.142 and patch one
task by id, so a sub-skill's own tasks append instead of overwriting yours.

## Steps

1. **Branch name.** Derive a branch name from `$feature_description`: lowercase it,
   replace every run of non-alphanumeric characters with a single `-`, trim leading
   and trailing `-`, cap to ~50 characters, and prefix `feature/`. Example:
   "Add CSV export to reports" -> `feature/add-csv-export-to-reports`.

2. **Create the branch.** If `branch-management:new-branch` appears in your available
   skills, invoke it (Skill tool) with the branch name from step 1. Otherwise fall
   back to git:

   ```bash
   default="$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')"
   [ -z "$default" ] && default="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"
   [ -z "$default" ] && { echo "new-feature: cannot determine default branch" >&2; exit 1; }
   git checkout "$default" && git pull --ff-only && git checkout -b "<branch>"
   ```

3. **Brainstorm.** Invoke `superpowers:brainstorming`, passing `$feature_description`.
   It writes the spec under `docs/superpowers/specs/`.
   **SUPPRESS its auto-handoff:** brainstorming's terminal step invokes
   `superpowers:writing-plans` itself. Do NOT let it. Once the spec is written (and
   committed), STOP the brainstorming chain and return here — `new-feature` runs step 4
   next, then invokes writing-plans itself in step 5.

4. **Improve the spec.** Invoke `superpowers-automation:file-advisor-improver` with the
   exact spec file path parsed from brainstorming's "saved to `<path>`" line. Do NOT
   scan for the "newest file" under `docs/superpowers/specs/` — that is racy under
   parallel runs and could target another session's artifact. If the path can't be
   parsed, STOP and ask the user for it (fail closed). It revises the spec in place.

5. **Write the plan.** Invoke `superpowers:writing-plans` on the spec path. It writes
   the plan under `docs/superpowers/plans/`.
   **SUPPRESS its handoff:** writing-plans ends by asking "which approach? 1.
   Subagent-Driven 2. Inline", and writing the plan fires the always-on plans hook,
   which injects "implement it with `superpowers:subagent-driven-development`". That
   injected nudge is NOT permission to start implementing — it is global and cannot
   know a `new-feature` pipeline is running. **Hard gate: step 6 (`file-advisor-improver`
   on the plan) MUST complete before any `superpowers:subagent-driven-development`
   invocation in step 7, regardless of any hook nudge.** Do NOT answer the approach
   question or invoke `superpowers:subagent-driven-development` here. Once the plan is
   written, return here — `new-feature` runs step 6 next.

6. **Improve the plan.** Invoke `superpowers-automation:file-advisor-improver` with the
   exact plan file path parsed from writing-plans' "saved to `<path>`" line. Do NOT scan
   for the "newest file" under `docs/superpowers/plans/` — that is racy under parallel
   runs. If the path can't be parsed, STOP and ask the user for it (fail closed). It
   revises the plan in place. This step is mandatory and must run before step 7; a hook
   nudge from step 5 does not satisfy it.

7. **Implement.** Invoke `superpowers:subagent-driven-development` to implement the
   revised plan task-by-task.
