---
name: build-task
description: >-
  End-to-end pipeline for a described task: design (explore, draft, review,
  spec) and delivery (plan, wave-parallel implementation, review (simplify +
  code-review), ship), all executed by prebuilt Workflow scripts shipped with this skill. Human
  checkpoints: open design questions and the intent confirmation, via the
  decide skill (AskUserQuestion, or with --headless the advisor or a decider agent).
argument-hint: "[--skip-branch-check] [--headless] [task-description]"
arguments: task_description
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Workflow", "AskUserQuestion", "ToolSearch", "EnterWorktree", "Skill", "Agent"]
---

# build-task

Runs the feature-development pipeline (Design → Intent confirmation → Spec →
Plan → Implement → Review → Ship) for `$task_description`, with the heavy phases
executed by Workflow scripts. All six are single-purpose scripts shipped in
the plugin's root `workflows/` directory and run by name as
`taskflow:build-task-<name>`: the design pipeline — explore, design, spec — and the
delivery pipeline — plan, implement, ship. Review is not a script: step 5.3
runs the `taskflow:review-task` skill. One usage reference per
script — parameters, exit contract, behavior — lives beside it; read the
relevant one BEFORE each invocation:

- [workflows/explore.md](workflows/explore.md) — scout → read-only
  explorers → exploration reports written to `EXPLORE_PATH`. Exits `complete`
  (path + explored subsystems) or `error`.
- [workflows/design.md](workflows/design.md) — Draft design → Design review
  → one revision round. Exits `complete` (draft decision-complete) or
  `user_input_required` (draft persisted + open user questions, resumable).
- [workflows/spec.md](workflows/spec.md) — Write spec → Spec review → one
  fix round. Exits `complete` (spec written) or `error`.
- [workflows/plan.md](workflows/plan.md) — Plan → plan check → one revision
  round. Exits `complete` (plan written to `PLAN_PATH`) or `error`.
- [workflows/implement.md](workflows/implement.md) — wave-parallel Implement
  (worktree/merge rules per wave size are in the reference). Exits `complete`
  (result file + per-task results) or `error` (hard stop).
- [workflows/ship.md](workflows/ship.md) — push, PR/MR create-or-update, CI
  watch with bounded fix rounds. Returns a `ship` object; ship problems are
  reportable states, not errors.

Runs inline because it invokes the Workflow tool directly — do NOT fork it.
**No Task-list integration**: the long-running work lives inside the
workflows, whose own `phase()`/`log()` output is the progress surface. This
skill only announces its steps as single plain-text lines ("Starting step N:
…") — announcements are never questions and never substitute for a step's own
required output (step 3's Keypoints are shown by its decide call).

> **Every decision goes through the `taskflow:decide` skill:**
> `Skill(skill: "taskflow:decide", args: "[--headless] <JSON>")`, with
> `--headless` exactly when this run got it, where `<JSON>` is one object
> `{"content": [<strings>], "questions": [{"id", "question", "options", "context"}]}`
> (1-4 questions, 2-4 options each, `context` optional);
> never ask in plain prose and never call `AskUserQuestion` directly.
> Use the answers from its final `DECISIONS:` line (`[{id, answer}]`). A
> decide output starting `decide:` → surface it and stop.

`$ARGUMENTS` may start with `--skip-branch-check` and/or `--headless` (bare
boolean flags, no value, either order) — parse and strip both before
anything else; whatever remains (trimmed) is the actual task text used
everywhere `$task_description` is referenced below. `--skip-branch-check`
makes step 1 trust the
already-checked-out work branch and skip its clean-tree check and worktree creation
(see step 1). Callers that have already established the correct, clean work
branch — notably `dispatch-task`, which always passes it — use this to avoid
a redundant check. `--headless` makes every decision without the user
(decide with `--headless`: the advisor or the `taskflow:decider` agent
answers) and the run never waits for input; where an interactive run would
ask again, a headless run stops with a report (step 3, and the resume cap in
step 2.4).

## Plugin context

Plugin root: ${CLAUDE_PLUGIN_ROOT}

Capture the `Plugin root:` value above and pass it to the ship script
as `PLUGIN_ROOT` (step 5.4) — agents cannot read `$CLAUDE_PLUGIN_ROOT` inside a
Bash-tool subprocess, so the script builds the absolute
`bin/ship-ensure-mergeable.mjs` path from it and hands it to shipper. This is
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

The scripts live in the plugin root `workflows/` directory as
`build-task-explore`, `build-task-design`, `build-task-spec`,
`build-task-plan`, `build-task-implement` and
`build-task-ship` (`.workflow.js`); their role agents (`taskflow:designer`,
`taskflow:planner`, …) live in the plugin's `agents/` and are dispatched by
the scripts via `agentType` — no skill directory is threaded through.

## Session temp files

Every pipeline file is session-only, never a repository file:

- **Directory:** `<session scratchpad>/build-task/` from your system prompt's
  scratchpad directory (create the subfolder). Pipeline files are written with the Write tool, and only the scratchpad is both outside the checkout (no worktree-isolation refusal) and skipped by the formatter hooks.
  Only when no scratchpad is provided, run `mktemp -d -t build-task-XXXXXX` once and use that: a formatter hook may then
  reformat a written file, which the scribes' size check catches and their
  Bash retry writes unformatted. Neither available → stop and report; every
  phase needs these files.
- **`<slug>`:** the work-branch name without its `<type>/` prefix when a work
  branch is already checked out; otherwise kebab-case from
  `$task_description`, ≤40 chars (then also names the worktree directory and
  its `feature/<slug>` branch, step 1).
- **Files:** `explore-<slug>.md` (`EXPLORE_PATH`), `draft-<slug>.md`
  (`DRAFT_PATH`), `spec-<slug>.md` (`SPEC_PATH`), `plan-<slug>.md`
  (`PLAN_PATH`), `implement-<slug>.json` (`IMPLEMENT_PATH`),
  `review-<slug>.json` (`REVIEW_PATH`), `pr-body-<slug>.md` (`PR_BODY_PATH`)
  — record and hand the workflows **absolute paths**, never inlined content.
  The pipeline files `explore-`/`draft-`/`spec-`/`plan-<slug>.md` and
  `implement-`/`review-<slug>.json` are always English, regardless of
  `$task_description`'s language (every agent's final-message rule plus the
  designer/spec-writer/planner rules) — they are read only by other agents
  in the pipeline, never shown to the user directly; `pr-body-<slug>.md`
  follows the repo's documentation language because it is human-facing. The skill never Reads these files,
  except `REVIEW_PATH`, which the skill writes itself in step 5.3; it
  passes their absolute paths to the workflows and uses only the structured
  returns. `SCRATCH_DIR` is this directory itself (absolute, trailing slash
  included) — passed to the implement script only.
- **Never commit them.** Durable artifacts are the branch and its commits.
  State in commit/PR descriptions when design context matters.

## Workflow invocation rules (all scripts)

1. **Probe once:** `ToolSearch(query: "select:Workflow")`. Tool absent, or a
   script is rejected with a meta/API validation error → stop and report.
   This skill deliberately has **no Agent-engine fallback** — the workflows
   are the engine.
2. **Invoke by name with `args`:** the scripts are plugin workflows in the
   plugin root `workflows/` directory, so they are auto-discovered and run
   namespaced by the plugin name. Never use `scriptPath`: the Workflow tool
   only loads a `scriptPath` it can itself read (working directory or an
   added directory), and the plugin cache is neither — the call is rejected.
   `Workflow({name: "taskflow:build-task-<name>", args})` with `<name>` =
   `explore`, `design`, `spec`, `plan`, `implement` or `ship` (no
   leading `/`), and ONE structured `args` object — the script reads it as
   the `args` global; keys and return contract are in the per-script
   reference files linked above. Structured data, so task text and user
   answers need no string escaping. The runtime may deliver the object
   serialized as a JSON string — the scripts' `decodeArgs` parses that
   transparently.
3. **Fallback — ad-hoc script with prepended args:** when a return is
   `stage: 'args'` and its `error` starts with `args global is undefined`:
   Read the script — `<Plugin root>/workflows/build-task-<name>.workflow.js` — prepend
   exactly one line after the `meta` block — `const args = { … }` as a JSON
   object literal — and send the whole text via the `script` parameter. NEVER
   pass the tool-level `args` parameter on an ad-hoc `{script}` call: the
   global arrives `undefined` there. Once the undefined-args fallback
   triggered, use it for every later script call in this invocation. Any
   other `stage: 'args'` error means a genuinely malformed payload — fix the
   call, never switch to the fallback for it.
4. **Consume only the structured return.** Never re-derive workflow state
   from transcript output; the return object is the contract. A return with
   `stage: 'args'` means the invocation itself was malformed — fix the call
   (or apply rule 3 for `args global is undefined`), do not debug the
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
   create-or-update, step 5) continues on it and updates that PR/MR. Either
   way — after the switch when (b) ran — capture `BRANCH_NAME` =
   `git branch --show-current` and `REPO_PATH` =
   `git rev-parse --show-toplevel` (absolute repo root) — also on the
   `--skip-branch-check` path (`dispatch-task` always passes it): the explore
   script and the plan script (steps 2 and 5) fail loud with
   `stage:'args'` on an empty `REPO_PATH` whenever graphmind is available.
2. **Design.** Four sub-steps; paths come from the temp directory above.
   1. **Graphmind probe.** Probe once whether graphmind is usable for this
      checkout: (a) `ToolSearch(query: "select:mcp__graphmind__gm_search")` —
      the tool's schema present in the result; and (b) run `graphmind which`
      via Bash — exit 0 (it prints the registered project slug; exit 1 when
      the checkout is not registered). Both ⇒ `GRAPHMIND_AVAILABLE = true`; no
      schema, `graphmind` not found, or exit 1 ⇒ `false`. Compute this once
      per `build-task` invocation and reuse the same value for the explore,
      design and step 5 calls (a value held in this running skill — never written to
      a file; no cross-run caching).
   2. **Explore.** Run the explore script (invocation rules above) with args
      `{TASK: $task_description, EXPLORE_PATH, GRAPHMIND_AVAILABLE, REPO_PATH}`
      (`REPO_PATH` from step 1). `error` → surface `stage` and `error`, then
      stop. `complete` → keep `explorePath` and `subsystems`. Explore runs
      once per invocation; resumes and corrections never re-run it.
   3. **Size** (once per invocation; reused on every resume and correction
      re-run). `ToolSearch(query: "select:mcp__jev-api__request")`. Schema
      returned ⇒ `JEV_AVAILABLE = true` (tool availability only), otherwise
      `false`; hold it like `GRAPHMIND_AVAILABLE`. Then
      `ToolSearch(query: "select:mcp__taskflow__size-task")` and call
      `mcp__taskflow__size-task` with `task` = the task text and `subsystems` =
      one string per returned subsystem (`<name> — <focus>`). The tool does the
      whole sizing (jev-api's calibrated question, then a model call when that
      is unsure); its result starts with the letter: `SIZE` = `S`, `M`, `L` or
      `XL`; print one line `Size: <result>`. Tool missing or an error result:
      decide `SIZE` yourself from the same inputs — `S` one single edit in one
      place, `M` a feature or fix with tests inside one plugin, `L` several
      distinct parts, a whole plugin or two to four plugins, `XL`
      repository-wide — and print `Size: <X> (own reasoning: <reason>)`. No
      retry loop; sizing never fails the run.
      `SIZE` picks the designer model, the planner model and the review level.
   4. **Design.** Run the design script with args
      `{TASK: $task_description, EXPLORE_PATH, DRAFT_PATH, SIZE, GRAPHMIND_AVAILABLE, REPO_PATH, RESUME: false, USER_INPUT: ''}`.
      Then by `status`:
      - `user_input_required` → one decide call (Decisions rule above) with
        `content: []` and `questions` = the returned `questions`, each mapped
        to `{id, question, options, context: whyItMatters}` (options verbatim).
        Re-run the design script with `RESUME: true`, the **same**
        `EXPLORE_PATH`, `DRAFT_PATH`, `SIZE`, `GRAPHMIND_AVAILABLE`
        and `REPO_PATH`, and `USER_INPUT` = the `DECISIONS` array unchanged
        (`[{id, answer}]`, a JSON value, never `[object Object]`). Repeat
        this bullet until `complete` or `error` — new genuine questions after
        a resume are expected, not a failure. Headless resume cap: with
        `--headless`, at most 3 design-script resumes per invocation (these
        answers and step 3 corrections together); a 4th needed resume → stop
        and report
        "headless design did not converge after 3 resumes" with `draftPath`.
      - `error` → surface `stage`, `error`, and `draftPath`, then stop.
      - `complete` → keep `keypoints` and the design `minorFindings`.
3. **Intent confirmation.** Read nothing aloud from memory: one decide call
   with `content` = the `keypoints` of the last design return, one item per
   bullet, verbatim (the user has never seen the temp files; decide shows
   them as a bullet list), and the one question
   `{"id": "intent", "question": "Does this match the intended design? Proceed to implementation? Picking No requires describing the change.", "options": ["Yes — proceed", "No — needs changes"]}`.
   Any answer other than the two options is the corrections. With
   corrections in hand → re-run step 2.4 (design script) with
   `RESUME: true`, `USER_INPUT` = the corrections, and the same
   `EXPLORE_PATH`, `DRAFT_PATH`, `SIZE`, `GRAPHMIND_AVAILABLE` and
   `REPO_PATH` (the script records the corrections as binding USER DECISIONs
   and rewrites the draft; handle its return as in step 2.4, headless resume
   cap included), then re-ask this step from the new keypoints. Explore and
   Size are not re-run. Only after
   "Yes" is the design **approved** — this is the pipeline's one human
   checkpoint on the design; the spec (step 4) is written from the approved
   draft. "No — needs changes" without corrections:
   - Interactive: one clarifying decide call with
     `{"id": "changes", "question": "What should change in the design?", "options": ["Proceed as designed after all", "Describe the change (via Other)"]}`;
     "Proceed as designed after all" counts as "Yes"; the option
     "Describe the change (via Other)" itself → ask that clarifying call
     once more; never guess. A free-text answer is the corrections.
   - Headless: stop and report
     "headless intent check rejected the design without corrections" with
     `draftPath` (no clarifying call in headless).
4. **Spec.** Runs once, after the "Yes" of step 3. Run the spec script with
   args `{DRAFT_PATH, SPEC_PATH}`.
   `error` → surface `stage`, `error`, and `draftPath`, then stop.
   `complete` with `specReviewed: false` → note it for the final report
   (step 6): the spec shipped without its completeness/ambiguity gate
   because the reviewer failed twice. Keep the spec `minorFindings`.
5. **Deliver.** Four sub-steps. Plan, Implement and Ship: read the reference,
   run the script (invocation rules above), branch on `status`. Review runs
   the `taskflow:review-task` skill. Paths come from the temp directory above.
   1. **Plan.** Run the plan script with args
      `{SPEC_PATH, PLAN_PATH, SIZE, GRAPHMIND_AVAILABLE, REPO_PATH, JEV_AVAILABLE}`
      (`SIZE` and `JEV_AVAILABLE` from step 2.3, the graphmind flag from step 2.1). `complete` →
      keep `plannerModel`.
   2. **Implement.** Run the implement script with args
      `{PLAN_PATH, IMPLEMENT_PATH, BRANCH_NAME, SCRATCH_DIR, GRAPHMIND_AVAILABLE, REPO_PATH}`
      (`SCRATCH_DIR` is the session-temp directory from "Session temp files"
      above, trailing slash included — implementers write their test-evidence
      files there for the per-task reviewer). `complete` → keep `tasks`,
      `waves` and the implement `minorFindings`.
   3. **Review.** Invoke
      `Skill(skill: "taskflow:review-task", args: "--size=<SIZE> <BASE_BRANCH>")`
      with the step-2.3 `SIZE`, with `--headless` prepended to `args` when
      this run got `--headless`; follow it to its report, then continue here.
      review-task commits pending changes, runs `simplify` and
      `code-review <level> --fix` over `<BASE_BRANCH>...HEAD`, commits each
      pass's edits and prints `Size:` and the line
      `Review level: <level> (size <X>)` (it owns the size → level table).
      review-task stopped on an error (branch guard, commit failure), or its
      report lists `simplify` or `code-review` as unavailable or failed →
      surface its message and stop (no Ship). Then check every commit
      review-task made (`git show <hash>`) against the approved spec: for
      each fix that reverses a spec decision, one decide call with
      `content` = [`<hash> <subject>`, the spec decision it reverses] and
      `{"id": "reversal-<hash>", "question": "Keep this fix or revert it?", "options": ["Keep", "Revert with git revert"]}`;
      never leave it unasked. "Revert with git revert" → run
      `git revert --no-edit <hash>` (failure → stop and report) and list the
      revert commit in `commits`; "Keep" → change nothing. Then Write `REVIEW_PATH`
      (English) with the Write tool:
      `{"size": "<SIZE>", "level": "<level>", "commits": ["<hash> <subject>", ...], "summary": "<simplify and code-review summary from the report, incl. found-but-not-fixed items>"}`
      — `commits` from the report's `git log --oneline` list. When
      review-task stopped with "no changes to review", write
      `"level": "none"`, `"commits": []` and that sentence as `summary`.
      Keep the `Review level:` line, the commits and the summary for step 6.
   4. **Ship.** Skip this sub-step when the user asked not to open a PR/MR
      (`$task_description` or a later message says so) — there is no ship arg
      for it; step 6 then reports "PR/MR skipped at the user's request".
      Otherwise run the ship script with args
      `{SPEC_PATH, PLAN_PATH, IMPLEMENT_PATH, REVIEW_PATH, PR_BODY_PATH, BRANCH_NAME, BASE_BRANCH, PLUGIN_ROOT, GRAPHMIND_AVAILABLE, REPO_PATH, JEV_AVAILABLE}`.
      It pushes, creates or updates the PR/MR and watches CI with bounded fix
      rounds; keep the returned `ship` object (url, CI outcome). Ship problems
      are reportable `ship.status` values, not errors.

   The one error rule for the script sub-steps (Plan, Implement, Ship): **any
   `status: "error"` (any stage) → surface `stage`, `error` and the returned
   `tasks`/`results`, then stop.** Stop means stop: a failed
   task or wave-merge conflict is a hard stop — never retry the merge, never
   resolve a conflict, and never continue on a half-implemented plan (the
   implement return's `results` are the per-task `taskResults` and name any
   abandoned worktrees/branches or left-behind commits for manual cleanup).
6. **Report.** Terminal step. Report one short summary: the `Size:` line, the
   planner model (`plannerModel` from the plan return), wave layout and
   per-task results (id, model, status — `waves` and `tasks` from the
   implement return), the `Review level:` line, the review commits and the
   review summary (step 5.3), the collected minor findings (the implement
   return's `minorFindings`, design — from the last design return — and
   spec — from the last spec return), and the `ship` outcome from the ship
   return (PR/MR url, CI status; on `ci_failed`/`blocked` state plainly what
   the human must pick up) — or "PR/MR skipped at the user's request".
   With `--headless`, the report also lists every `Decided ...` line that
   decide printed.
   Merging the PR/MR is not this skill's job.
