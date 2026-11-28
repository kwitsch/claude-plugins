---
name: review-task
description: >-
  Review and fix every change of the current branch: commits pending changes,
  then runs a simplify, review, organize and fix workflow over the branch diff
  against its base, at a depth taken from --size (S/M/L/XL) or sized
  automatically. With --spec, fixes that would contradict the spec go
  through the decide skill. Use when the user asks to review, audit or check
  the current branch's changes.
argument-hint: "[--headless] [--size=S|M|L|XL] [--spec=<path>] [base ref]"
allowed-tools: ["Read", "Bash", "Skill", "ToolSearch", "mcp__taskflow__size-task", "mcp__taskflow__get-environment", "Workflow", "AskUserQuestion", "Agent"]
---

# review-task — commit, then simplify, review, organize and fix the branch

Guarantees a fully committed branch, then runs the workflow script
`taskflow:review-task-stages` over every change of the current branch
against its base: Simplify (Claude Code's bundled `simplify` skill, one
commit), Review (read-only jobs in parallel: the bundled `code-review` at a
depth derived from the task size, plus `ponytail:ponytail-review` and the
CodeRabbit CLI when `mcp__taskflow__get-environment` reports them), Organize
(dedupe, severity, and with `--spec` a check of every fix against the spec)
and Fix (applies the findings, commits, rereviews; at most 2 rounds). The
workflow never applies a fix that would contradict the spec: this skill puts
each one to `taskflow:decide` and sends the chosen ones back through the Fix
stage. This skill runs inline: it calls the `Skill` and `Workflow` tools and
must keep their results, so never run it as `context: fork`. It never
pushes, opens a PR/MR or merges; `build-task` calls it as its Review step
(step 4.3) and pushes in Ship.

Run every git command with the Bash tool as an ordinary command. Commit
messages carry no `Co-Authored-By:` trailer and no "Generated with" footer.

## Plugin context

Plugin root: ${CLAUDE_PLUGIN_ROOT}

The `Plugin root:` value above is a plain text substitution, used only by the
args fallback of step 8. Empty or unresolved → that fallback is unavailable;
report the args error instead.

## Decisions

Every decision of this skill goes through
`Skill(skill: "taskflow:decide", args: "[--headless] <JSON>")` with
`--headless` exactly when this run got it (`HEADLESS`, step 1), where
`<JSON>` is one object
`{"content": [<strings>], "questions": [{"id", "question", "options", "context"}]}`
(1-4 questions, 2-4 options each, `context` optional), and use the answers
from its final `DECISIONS:` line; never call `AskUserQuestion` directly.
review-task's own decision point is step 9: spec conflicts of the simplify
commit and of review findings. The workflow's agents never ask: they take
the conservative choice and report it. A decide output starting `decide:` →
note it for the report and continue as step 9 says.

## 1. Parse arguments

`$ARGUMENTS` may hold `--headless`, one `--size=<v>` token, one
`--spec=<path>` token and a base ref, in any order.
Strip `--headless` first (sets `HEADLESS`), then the `--size=<v>` token, then the `--spec=<path>` token.

- `--size`: `<v>` uppercased must be one of `S`, `M`, `L` or `XL`; anything
  else → stop with exactly `Invalid --size "<v>": use S, M, L or XL.` and do
  nothing else (no git command). Set `SIZE` to the uppercased value, or
  leave it unset when the token is absent.
- `--spec`: `<v>` is the text after `--spec=`. An empty `<v>`, or
  `test -f "<v>"` failing → stop with exactly
  `Invalid --spec "<v>": no such file.` and run no other command. Otherwise
  `SPEC_PATH` = the output of `realpath "<v>"` (absolute). Without the token
  `SPEC_PATH` is `""`.
- The remaining text, trimmed, is `BASE`. When it is empty, run
  `git symbolic-ref --short refs/remotes/origin/HEAD` and strip the
  `origin/` prefix from its output; when that command fails, `BASE` = `main`.

## 2. Branch guard

- `BRANCH_NAME` = output of `git branch --show-current`. Empty (detached
  HEAD) → stop: "review-task needs a branch: check out a branch first".
- `BRANCH_NAME` equals `BASE` → stop: "review-task commits onto the current
  branch; refusing to commit on the base branch `<BASE>`".
- Record `START` = output of `git rev-parse HEAD`.

## 3. Commit pending changes

`git status --porcelain` non-empty → `git add -A`, then
`git commit -m "Commit pending changes before review"`. `git add -A` never
stages `.gitignore`d files (e.g. `plugin/`). A failing commit (pre-commit hook
rejection, missing identity) → stop and show git's output verbatim. Never
reset, stash or check out anything: no work is ever discarded.

## 4. Diff check

First `git rev-parse --verify --quiet "<BASE>^{commit}"` must succeed, else
stop and report that `<BASE>` is not a valid ref. Then
`git diff --quiet "<BASE>"...HEAD` exits 0 → report "no changes to review
against `<BASE>`" (plus the step-3 commit, if one was made) and stop.

## 5. Size

With `--size` given, print `Size: <SIZE> (from --size)` and go to step 6.

Otherwise `ToolSearch(query: "select:mcp__taskflow__size-task")`, then call
`mcp__taskflow__size-task` with no `subsystems` and `task` =

    Review of branch <BRANCH_NAME> against <BASE>. Commits:
    <output of git log --format=%s <BASE>..HEAD>
    Changed files:
    <output of git diff --stat <BASE>...HEAD>

The result starts with the size: `SIZE` = `S`, `M`, `L` or `XL`; print one
line `Size: <result>`. Tool missing or an error result: decide `SIZE`
yourself from the same input (`S`, `M`, `L` or `XL`) and print
`Size: <X> (own reasoning: <reason>)`. No retry; sizing never fails the run.

## 6. Level

`LEVEL` from `SIZE`: `S` → `medium`, `M` → `high`, `L` → `xhigh`, `XL` → `max`.
Print one line `Review level: <level> (size <X>)`.

## 7. Environment

`ToolSearch(query: "select:mcp__taskflow__get-environment")`, then call
`mcp__taskflow__get-environment` with no input. Its result is one JSON
object of five booleans, `jevApi`, `advisor`, `graphmind`, `ponytail` and
`coderabbit`; that object is `ENV`. Tool missing, a refusal, or text that is
not such an object → `ENV` = all five `false`, and note "get-environment
unavailable: only the code-review job runs" for the report. Print one line:

`Environment: jev-api <yes|no>, advisor <yes|no>, graphmind <yes|no>, ponytail-review <yes|no>, coderabbit <yes|no>`

## 8. Workflow

Read the usage reference [workflows/review.md](workflows/review.md) before
the first call. `ToolSearch(query: "select:Workflow")` once; tool absent →
go to step 12 and report `review-task: Workflow tool unavailable`.
`REPO_PATH` = output of `git rev-parse --show-toplevel`.

`Workflow({name: "taskflow:review-task-stages", args: {MODE: "full", BASE, BRANCH: BRANCH_NAME, LEVEL, SPEC_PATH, ENV, REPO_PATH}})`
with ONE structured `args` object: `SPEC_PATH` is `""` without `--spec`,
`ENV` is the object from step 7, never a string. Never use `scriptPath`: the
plugin cache is not readable for it. Fallback, only when the return is
`stage: 'args'` and its `error` starts with `args global is undefined`: Read
`<Plugin root>/workflows/review-task-stages.workflow.js`, prepend exactly one
line after the `meta` block — `const args = { … }` as a JSON object literal —
and send the whole text via the `script` parameter, without the tool-level
`args` parameter; use the same fallback for the step-10 run.

- `status: "error"` → skip steps 9-11 and go to step 12. The report states
  `review-task: <stage>: <error>`, the commits so far and the output of
  `git status --porcelain` as dirty paths. The final check does not run, so
  a reviewer's stray edits are never committed.
- `status: "complete"` → keep `simplify`, `reviews`, `organize`, `fix`,
  `specFindings` and `simplifySpecConflict` for steps 9-12.

## 9. Spec decisions

Only when the return has a `simplifySpecConflict` or a non-empty
`specFindings`. `--headless` is forwarded to every decide call.

- **Simplify commit.** One decide call with `content` = [the
  `<hash> <subject>` of `simplifySpecConflict.commit`, its `decision`, its
  `reason`] and the question
  `{"id": "simplify-<short hash>", "question": "The simplify commit reverses a spec decision. Keep it or revert it?", "options": ["Keep", "Revert with git revert"]}`.
  "Revert with git revert" → run `git revert --no-edit <hash>`; a failing
  revert (the Fix stage may have changed the same lines) → run
  `git revert --abort`, then stop and go to step 12 with git's output, so no
  half-applied revert is left in the tree. "Keep" → change nothing.
- **Findings.** Decide calls of at most 4 questions each, in `specFindings`
  order. Per finding:
  `{"id": "<finding id>", "question": "Fix this finding against the spec, or keep the spec's implementation?", "options": ["Fix against the spec", "Keep the spec implementation"], "context": "<severity> <file>:<line> <title>"}`.
  `content`: one bullet per finding of that call,
  `<id>: <detail> Proposed fix: <fix> Spec decision: <decision>`. Collect
  every finding answered "Fix against the spec", as its full object from
  `specFindings`, into `CHOSEN`.
- A decide output starting `decide:` → every finding of that call is kept
  as the spec has it (the simplify commit is kept); note it for the report.

## 10. Decided fixes

`CHOSEN` non-empty →
`Workflow({name: "taskflow:review-task-stages", args: {MODE: "fix", BASE, BRANCH: BRANCH_NAME, LEVEL, SPEC_PATH, ENV, REPO_PATH, FINDINGS: CHOSEN}})`.
`FINDINGS` is the array of the chosen finding objects as the first run
returned them. Pass `args` as an object, never as a string built by
concatenation (that yields `[object Object]`).

- `status: "error"` → report `review-task: <stage>: <error>`, list every
  chosen finding as unresolved, and still run step 11.
- `status: "complete"` → keep its `fix` for the report.

## 11. Final check

`git status --porcelain` must be empty. Otherwise `git add -A`, then
`git commit -m "Apply leftover review changes"`. Still not empty → list
the dirty paths in the report.

## 12. Report

The last message of the skill, plain text:

- the `Size:`, `Review level:` and `Environment:` lines, plus the
  get-environment note from step 7 if there is one;
- `git log --oneline <START>..HEAD`: every commit this run made;
- one paragraph per stage: Simplify (what it changed, or why it failed),
  Review (each entry of `reviews` with its status, reason and finding
  count), Organize (`total`, `merged`, `dismissed`, `fixable`, `spec`), Fix
  (the fixed ids, the commits and the rounds of the full run and of the
  step-10 run);
- unresolved findings: every `fix.unresolved` entry of both runs as
  `<id> <severity> <file>:<line> <title> (<reason>)`, plus the chosen
  findings of a failed step-10 run;
- the spec decisions and their outcome: fixed against the spec, kept as the
  spec has it, simplify commit kept or reverted;
- every skipped or failed step (`review-task: <stage>: <error>`, a commit
  failure, dirty paths left, a `decide:` output);
- with `--headless`, every `Decided ...` line that decide printed.

No push, no PR/MR.
