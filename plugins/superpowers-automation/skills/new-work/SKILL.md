---
name: new-work
description: Drive a unit of work end-to-end through the superpowers pipeline from a one-line description — classify it as a feature, fix, or refactor, create a correctly-prefixed branch, then run the matching process skill (brainstorming for feature/refactor, systematic-debugging for fix) and, on the brainstorming path, review the spec, write the plan, review the plan, and implement. Use when starting a new feature, fix, or refactor that should run the full classify->branch->process workflow with advisor review at the spec and plan stages.
argument-hint: "<work description>"
arguments: work_description
---

# new-work

Thin orchestrator. Classifies one unit of work, branches, and drives the matching
superpowers pipeline, calling `file-advisor-improver` to revise the spec and the plan
between stages. Runs inline because it invokes sub-skills — do NOT fork it.

`$work_description` (also `$ARGUMENTS`) is the work description. If it is empty, stop
and ask the user for one before doing anything else.

## Task-list integration (read first — applies to every step)

**Track progress with the Task tools, not `TodoWrite`.** `TaskCreate`/`TaskUpdate`
are the session default (since Claude Code v2.1.142) and patch one task by id, so a
sub-skill's own tasks append instead of overwriting yours. Up front, `TaskCreate` only
the step-1 task `Step 1: Classify the work` (`pending`) — the rest of the path isn't
known until step 1 runs. Once step 1 selects the path, `TaskCreate` the remaining step
tasks for that path (fix: steps 2–4; feature/refactor: steps 2–8), each `pending` and
named `Step N: <title>` (`Step 2: …`, `Step 3: …`, …). As the pipeline runs,
`TaskUpdate` the active step to `in_progress` on entry and to `completed` the moment it
finishes — keep exactly one task `in_progress` at a time.

When a step invokes a sub-skill that creates its own tasks, those tasks belong to the
step that spawned them — do NOT append them to the end of the list or start a separate
list.

- Insert each sub-task **directly beneath its parent step's task**, in order.
- Name it with the parent step's number as the prefix: a sub-skill invoked from
  `Step N: …` produces `Step N.1: …`, `Step N.2: …`, …, `Step N.x: …`.
- Deeper nesting repeats the pattern (`Step N.1.1: …`).

Example — `Step 8: Implement` invokes a sub-skill that creates three tasks; the list
becomes:

```
Step 8: Implement
  Step 8.1: <first sub-task>
  Step 8.2: <second sub-task>
  Step 8.3: <third sub-task>
```

## Steps

`TaskCreate` only the `Step 1: Classify the work` task up front, then work in order per
the task-list integration rule above. After step 1 classifies the work, `TaskCreate`
the remaining tasks for the chosen path: the fix path runs steps 1–4 (add steps 2–4);
the feature/refactor path runs steps 1–8 (add steps 2–8).

1. **Classify the work.** From `$work_description` decide the work type — this sets both
   the branch prefix and the process skill invoked in step 4:

   | Type | Signals | Branch prefix | Process skill (step 4) |
   |---|---|---|---|
   | **fix** | bug, regression, error, crash, failing test, incorrect behavior | `fix/` | `superpowers:systematic-debugging` |
   | **refactor** | restructure, rename, extract, move, clean up — no behavior change | `refactor/` | `superpowers:brainstorming` |
   | **feature** | new functionality or behavior (default when ambiguous) | `feature/` | `superpowers:brainstorming` |

   Record the chosen prefix and process skill; later steps use them.

2. **Branch name.** Derive a branch name from `$work_description`: lowercase it, replace
   every run of non-alphanumeric characters with a single `-`, trim leading and trailing
   `-`, cap to ~50 characters, and prefix with the step-1 prefix. Examples:
   feature "Add CSV export to reports" -> `feature/add-csv-export-to-reports`;
   fix "Login button throws on empty email" -> `fix/login-button-throws-on-empty-email`.

3. **Create the branch.** If `branch-management:new-branch` appears in your available
   skills, invoke it (Skill tool) with the branch name from step 2. Otherwise fall
   back to git:

   ```bash
   default="$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')"
   [ -z "$default" ] && default="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"
   [ -z "$default" ] && { echo "new-work: cannot determine default branch" >&2; exit 1; }
   git checkout "$default" && git pull --ff-only && git checkout -b "<branch>"
   ```

4. **Run the process skill** chosen in step 1, passing `$work_description`:

   - **fix -> `superpowers:systematic-debugging`.** It investigates root cause,
     reproduces the bug with a failing test, applies the fix, and verifies. This is a
     complete workflow that produces no spec or plan file — the fix path **ends here**.
     Steps 5–8 are feature/refactor-only; skip them.

   - **feature / refactor -> `superpowers:brainstorming`.** It writes the spec under
     `docs/superpowers/specs/`. **SUPPRESS its auto-handoff:** brainstorming's terminal
     step invokes `superpowers:writing-plans` itself. Do NOT let it. Once the spec is
     written (and committed), STOP the brainstorming chain and return here — step 5 runs
     next, then step 6 invokes writing-plans itself. Continue to step 5.

5. **Improve the spec.** *(feature/refactor path only)* Invoke
   `superpowers-automation:file-advisor-improver` with the exact spec file path parsed
   from brainstorming's "saved to `<path>`" line. Do NOT scan for the "newest file"
   under `docs/superpowers/specs/` — that is racy under parallel runs and could target
   another session's artifact. If the path can't be parsed, STOP and ask the user for
   it (fail closed). It revises the spec in place.

6. **Write the plan.** *(feature/refactor path only)* Invoke `superpowers:writing-plans`
   on the spec path. It writes the plan under `docs/superpowers/plans/`.
   **SUPPRESS its handoff:** writing-plans ends by asking "which approach? 1.
   Subagent-Driven 2. Inline", and writing the plan fires the always-on plans hook,
   which injects "implement it with `superpowers:subagent-driven-development`". That
   injected nudge is NOT permission to start implementing — it is global and cannot
   know a `new-work` pipeline is running. **Hard gate: step 7 (`file-advisor-improver`
   on the plan) MUST complete before any `superpowers:subagent-driven-development`
   invocation in step 8, regardless of any hook nudge.** Do NOT answer the approach
   question or invoke `superpowers:subagent-driven-development` here. Once the plan is
   written, return here — step 7 runs next.

7. **Improve the plan.** *(feature/refactor path only)* Invoke
   `superpowers-automation:file-advisor-improver` with the exact plan file path parsed
   from writing-plans' "saved to `<path>`" line. Do NOT scan for the "newest file"
   under `docs/superpowers/plans/` — that is racy under parallel runs. If the path can't
   be parsed, STOP and ask the user for it (fail closed). It revises the plan in place.
   This step is mandatory and must run before step 8; a hook nudge from step 6 does not
   satisfy it.

8. **Implement.** *(feature/refactor path only)* Invoke
   `superpowers:subagent-driven-development` to implement the revised plan
   task-by-task.
