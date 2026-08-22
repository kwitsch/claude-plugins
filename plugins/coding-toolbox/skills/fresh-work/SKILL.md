---
name: fresh-work
description: >-
  Use when starting a new unit of work (feature, fix, or refactor) from a one-line
  description: classify the work, cut a branch via fresh-branch, dispatch to the
  matching pipeline skill (debugging or feature-development), and finish by
  opening a PR/MR via fresh-pr. No dependencies outside coding-toolbox.
argument-hint: "[work-description]"
arguments: work_description
allowed-tools: ["Skill", "Read", "ToolSearch", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop"]
---

# fresh-work

Plugin root: ${CLAUDE_PLUGIN_ROOT}

Thin dispatcher: classifies one unit of work, branches via `fresh-branch`,
invokes the one sibling skill that runs the matching pipeline
(`debugging`/`feature-development`), and finishes via `fresh-pr`. Runs inline
because it invokes sub-skills — do NOT fork it.

`$work_description` is the work description. If it is empty, ask for one via
`AskUserQuestion` before doing anything else (offer 2–3 illustrative examples as
options; the real description arrives via "Other" free text). Never guess.

## Task-list integration

Read `<plugin root above>/skills/feature-development/references/dispatch-shared.md`
for the shared `AskUserQuestion` banner, Task-list core, and step-start
reporting convention. In addition, specific to this skill: up front create
only `Step 1: Classify the work`; after step 1 create the remaining steps
(`Step 2: Branch name` through `Step 5: PR`). Example step-start
announcement, per that shared convention, when step 4 (Dispatch) actually
becomes `in_progress` (never before step 1 has even started):

> Starting step 4: Dispatch.

`Step 4`'s task itself stays `in_progress` for the whole dispatched call —
see `dispatch-shared.md`'s scoping rule and `feature-development`'s own
Task-list section for why that's expected, not a ledger violation.

## Steps

1. **Classify.** From `$work_description`:

   | Type         | Signals                                                           | Branch prefix | Skill                                |
   | ------------ | ----------------------------------------------------------------- | ------------- | ------------------------------------ |
   | **fix**      | bug, regression, error, crash, failing test, incorrect behavior   | `fix/`        | `coding-toolbox:debugging`           |
   | **refactor** | restructure, rename, extract, move, clean up — no behavior change | `refactor/`   | `coding-toolbox:feature-development` |
   | **feature**  | new functionality or behavior (default when ambiguous)            | `feature/`    | `coding-toolbox:feature-development` |

   `refactor` and `feature` both dispatch to `feature-development` — the two
   classifications run an identical pipeline; only the branch prefix (picked
   in step 2, from this table) differs.

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
   within itself — this skill performs none of it directly. Its own steps
   nest under this one (`Step 4.1`, `Step 4.2`, …) rather than creating
   independent top-level entries — see its own Task-list integration section.
   `feature-development` carries forward a minor-findings list (produced
   during its own Implement step, passed through unchanged by Review) to this
   step; `debugging` carries nothing forward. Any failure the invoked skill
   reports (blocked task, failed debug loop) stops the pipeline here — do not
   proceed to step 5.
5. **PR.** Invoke `coding-toolbox:fresh-pr` (Skill tool), surfacing any minor
   findings carried from step 4. Terminal step.
