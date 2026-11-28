---
name: review-task
description: >-
  Review and fix every change of the current branch: commits pending changes,
  then runs /simplify and /code-review --fix over the branch diff against its
  base, at a depth taken from --size (S/M/L/XL) or sized automatically. Use
  when the user asks to review, audit or check the current branch's changes.
argument-hint: "[--headless] [--size=S|M|L|XL] [base ref]"
allowed-tools: ["Bash", "Skill", "ToolSearch", "mcp__taskflow__size-task", "AskUserQuestion", "Agent"]
---

# review-task — commit, simplify and code-review the branch

Guarantees a fully committed branch, then lets Claude Code's bundled
`simplify` skill (reuse, simplification and efficiency cleanup) and its
bundled `code-review` skill (correctness, with `--fix`) review and fix every
change of the current branch against its base, at a depth derived from the
task size. Each pass's edits land as their own commit. This skill runs
inline: it calls the `Skill` tool and must keep the results, so never run it
as `context: fork`. It never pushes, opens a PR/MR or merges; `build-task`
calls it as its Review step (step 5.3) and pushes in Ship.

Run every git command with the Bash tool as an ordinary command. Commit
messages carry no `Co-Authored-By:` trailer and no "Generated with" footer.

## Decisions

Whenever this skill, or `simplify` or `code-review` while running inside it,
needs a decision from the user, invoke
`Skill(skill: "taskflow:decide", args: "[--headless] <JSON>")` with
`--headless` exactly when this run got it (`HEADLESS`, step 1), where
`<JSON>` is one object
`{"content": [<strings>], "questions": [{"id", "question", "options", "context"}]}`
(1-4 questions, 2-4 options each, `context` optional), and use the answers
from its final `DECISIONS:` line; never call `AskUserQuestion` directly.
A decide output starting `decide:` → note it for the report and continue
without the change that needed the decision. review-task has no decision
point of its own; this covers questions the bundled skills raise.

## 1. Parse arguments

`$ARGUMENTS` may hold `--headless`, one `--size=<v>` token and a base ref, in
any order. Strip `--headless` first (sets `HEADLESS`), then the `--size=<v>` token.
`<v>` uppercased must be one of `S`, `M`,
`L` or `XL`; anything else → stop with exactly
`Invalid --size "<v>": use S, M, L or XL.` and do nothing else (no git
command). Set `SIZE` to the uppercased value, or leave it unset when the
token is absent. The remaining text, trimmed, is `BASE`. When it is empty,
run `git symbolic-ref --short refs/remotes/origin/HEAD` and strip the
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

## 7. Simplify

`Skill(skill: "simplify", args: "the changes of git diff <BASE>...HEAD on branch <BRANCH_NAME>")`
and follow it to its end. Afterwards `git status --porcelain` non-empty →
`git add -A`, then `git commit -m "Simplify branch changes"`. The skill is
unavailable or errors → note that for the report and continue with step 8.

## 8. Code review

`Skill(skill: "code-review", args: "<LEVEL> --fix <BRANCH_NAME>")` and follow
it to its end. Afterwards `git status --porcelain` non-empty → `git add -A`,
then `git commit -m "Apply code-review fixes"`. The skill is unavailable or
errors → note that for the report.

A commit that fails in step 7 or 8 → keep git's output for the report and go
on; step 9 lists what stayed uncommitted.

## 9. Final check

`git status --porcelain` must be empty. Otherwise `git add -A`, then
`git commit -m "Apply leftover review changes"`. Still not empty → list
the dirty paths in the report.

## 10. Report

The last message of the skill, plain text:

- the `Size:` line and the `Review level:` line;
- `git log --oneline <START>..HEAD`: every commit this run made, including
  commits a skill made itself;
- one paragraph on what `simplify` changed and one on what `code-review`
  fixed or found but did not fix;
- every skipped or failed step (skill unavailable, commit failure, dirty
  paths left, a `decide:` output);
- with `--headless`, every `Decided ...` line that decide printed.

No push, no PR/MR.
