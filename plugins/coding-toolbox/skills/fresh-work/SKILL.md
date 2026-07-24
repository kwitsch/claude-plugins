---
name: fresh-work
description: >-
  Use when starting a new unit of work (feature, fix, or refactor) from a one-line
  description: classify the work, cut a branch via fresh-branch, dispatch to the
  matching pipeline skill (debugging, feature-development, or refactoring), and
  finish by opening a PR/MR via fresh-pr. No dependencies outside coding-toolbox.
argument-hint: "[work-description]"
arguments: work_description
allowed-tools: ["Skill", "ToolSearch", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop"]
---

# fresh-work

Thin dispatcher: classifies one unit of work, branches via `fresh-branch`,
invokes the one sibling skill that runs the matching pipeline
(`debugging`/`feature-development`/`refactoring`), and finishes via
`fresh-pr`. Runs inline because it invokes sub-skills — do NOT fork it.

`$work_description` is the work description. If it is empty, ask for one via
`AskUserQuestion` before doing anything else (offer 2–3 illustrative examples as
options; the real description arrives via "Other" free text). Never guess.

> **User decisions go through `AskUserQuestion`** — fixed-choice and open-ended
> alike; never plain prose that waits for a typed reply.

## Task-list integration

Track progress with the Task tools, never TodoWrite. Load them once
(`ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`,
deferred; resolve at depth 0). Up front create only `Step 1: Classify the
work`; after step 1 create the remaining steps (`Step 2: Branch name` through
`Step 5: PR`). Keep exactly one task `in_progress`.

**Step-start reporting.** Each time a step task moves to `in_progress`, state
one short line to the user naming it before starting its work — plain output,
never a question — e.g.:

> Starting step 4: Dispatch.

## Steps

1. **Classify.** From `$work_description`:

   | Type | Signals | Branch prefix | Skill |
   |---|---|---|---|
   | **fix** | bug, regression, error, crash, failing test, incorrect behavior | `fix/` | `coding-toolbox:debugging` |
   | **refactor** | restructure, rename, extract, move, clean up — no behavior change | `refactor/` | `coding-toolbox:refactoring` |
   | **feature** | new functionality or behavior (default when ambiguous) | `feature/` | `coding-toolbox:feature-development` |

2. **Branch name.** Summarize the work in 3–6 **English** words (translate a
   non-English description — never slugify it verbatim), lowercase, collapse
   every non-alphanumeric run to a single `-`, trim leading/trailing `-`, cap
   at ~50 characters, prefix from step 1. Examples: feature "Add CSV export
   to reports" → `feature/add-csv-export-to-reports`; feature "coding-toolbox
   erweiterung: ein Hook der … encoding prüft …" →
   `feature/encoding-guard-hook`. State the derived name to the user (plain
   output, not a question) before step 3.
3. **Branch.** Invoke `coding-toolbox:fresh-branch` (Skill tool) with the branch
   name. `name_exists` → `AskUserQuestion` (switch to the existing branch / pick a
   different name), then re-run. Any other failure → report per its exit-code map
   and stop.
4. **Dispatch.** Invoke the skill named in step 1's table (Skill tool) with
   `$work_description`. It runs the full pipeline for that work type entirely
   within itself — this skill performs none of it directly.
   `feature-development` (and, via delegation, `refactoring`) carries forward
   a minor-findings list from its own Review step; `debugging` carries
   nothing forward. Any failure the invoked skill reports (blocked task,
   failed debug loop) stops the pipeline here — do not proceed to step 5.
5. **PR.** Invoke `coding-toolbox:fresh-pr` (Skill tool), surfacing any minor
   findings carried from step 4. Terminal step.
