---
name: fresh-work
description: >-
  Use when starting a new unit of work (feature, fix, or refactor) from a one-line
  description that should run the full self-contained pipeline: classify the work,
  cut a branch via fresh-branch, design and plan (feature/refactor) or debug
  systematically (fix), implement task-by-task via workflow-driven development, and
  finish by opening a PR/MR via fresh-pr. No dependencies outside coding-toolbox.
argument-hint: "[work-description]"
arguments: work_description
allowed-tools: ["Skill", "Read", "Write", "Edit", "Grep", "Glob", "Bash", "Agent", "Workflow", "ToolSearch", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop"]
---

# fresh-work

Thin orchestrator: classifies one unit of work, branches via `fresh-branch`, runs
the matching phase pipeline from `references/`, and finishes via `fresh-pr`. Runs
inline because it invokes sub-skills — do NOT fork it.

`$work_description` is the work description. If it is empty, ask for one via
`AskUserQuestion` before doing anything else (offer 2–3 illustrative examples as
options; the real description arrives via "Other" free text). Never guess.

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

## Inline advisor protocol

Runs after the design doc (step 5) and after the plan (step 8); also consult the
advisor on genuinely hard design decisions in any phase.

1. Probe once per session for an advisor tool (`ToolSearch`, query `advisor`);
   remember the outcome.
2. **Advisor available:** call it inline on the document (path + content), then
   revise the file in place from the actionable feedback — a revision, not appended
   notes. Verify any feedback claiming tool/API capabilities against the live tool
   schema before applying it, and never let feedback reverse an explicit user
   decision — surface such conflicts via `AskUserQuestion` instead.
3. **No advisor:** graceful no-op — run the structured self-review from the phase
   reference and continue. Do NOT substitute a user review request.

## Task-list integration

Track progress with the Task tools, never TodoWrite. Load them once
(`ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`,
deferred; resolve at depth 0). Up front create only `Step 1: Classify the work`;
after step 1 create the remaining steps for the chosen path (feature/refactor:
steps 2–11; fix: steps 2–5). Keep exactly one task `in_progress`. Work a phase
spawns nests beneath its step as `Step N.1…N.x`.

## Steps — both paths

1. **Classify.** From `$work_description`:

   | Type | Signals | Branch prefix | Pipeline |
   |---|---|---|---|
   | **fix** | bug, regression, error, crash, failing test, incorrect behavior | `fix/` | debug path (steps 4–5 below) |
   | **refactor** | restructure, rename, extract, move, clean up — no behavior change | `refactor/` | design path (steps 4–11 below) |
   | **feature** | new functionality or behavior (default when ambiguous) | `feature/` | design path (steps 4–11 below) |

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

## Steps — feature/refactor path

4. **Design.** Read `references/designing.md`; produce the design doc at the spec
   temp path.
5. **Advisor pass (spec).** Inline advisor protocol on the design doc.
6. **Intent confirmation.** Present the design doc's Keypoints section verbatim to
   the user, then ask via `AskUserQuestion`: does this match their intent, proceed
   to planning? Options: **Yes — proceed** / **No — needs changes** (specific
   corrections arrive via "Other"). "No" picked without "Other" detail → ask one
   clarifying `AskUserQuestion` round for what should change before touching the
   design doc; never guess at a revision. Once feedback is in hand → revise the
   design doc to address it (repeat step 5's advisor pass first only if the
   revision changes scope or approach), then re-ask this step. "Yes" → continue
   to step 7. This is the pipeline's one human-facing checkpoint on the design —
   the advisor passes (steps 5 and 8) are the correctness validation, not this
   step.
7. **Plan.** Read `references/planning.md`; produce the plan at the plan temp path
   from the revised design doc.
8. **Advisor pass (plan).** Inline advisor protocol on the plan. **Hard gate: this
   pass completes before any implementation starts** — no nudge, hook, or plan
   header overrides it.
9. **Implement.** Read `references/implementing.md`; run the workflow-driven
   implementation over the plan's tasks.
10. **Review.** Invoke `simplify` (Skill tool) over the branch diff to apply
    reuse/simplification/efficiency/altitude cleanups directly, then — only if
    it changed anything (check `git status --porcelain`; nothing staged means
    nothing to commit) — commit those fixes as one commit (repo conventions).
    Then invoke `code-review` (Skill tool, args `max --fix`) over the resulting
    diff to find and apply correctness-bug and reuse/simplification/efficiency
    fixes at max effort, and — same guard — commit those as a separate commit
    if it changed anything. Each sub-pass that produces changes gets its own
    commit (repo convention: one fix per commit, never bundled) so the two
    categories of change stay distinguishable in history, and so
    `code-review`'s own diff gathering sees `simplify`'s fixes as committed
    history rather than stray working-tree state. Both act on the full
    accumulated diff from step 9, not a single task's commit. This step does
    not consume step 9's minor-findings list — it runs its own independent
    scan and has no input mechanism for that plan-specific ledger content;
    carry the list forward unchanged to step 11. A finding that would reverse a
    design/plan decision (not a quality nit) → stop and surface it via
    `AskUserQuestion` instead of letting the fix apply silently.
11. **PR.** Invoke `coding-toolbox:fresh-pr` (Skill tool), surfacing any
    recorded minor review findings carried from step 9 to its commit stage.
    Terminal step.

## Steps — fix path

4. **Debug.** Read `references/debugging.md`; root cause → failing test → fix →
   verify, all committed on the work branch. No separate Review step: Phase 4's
   own verify (new test passes, suite green, symptom gone) covers a single
   targeted fix; Review's whole-diff `simplify`/`code-review max` pass is scoped
   to the design path's larger, multi-task diffs.
5. **PR.** Invoke `coding-toolbox:fresh-pr` (Skill tool). Terminal step.
