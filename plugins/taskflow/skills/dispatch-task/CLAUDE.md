# CLAUDE.md — taskflow/skills/dispatch-task

`SKILL.md` dispatches `/taskflow:build-task --skip-branch-check <task text>` into a new worktree-isolated background session (`claude --worktree <name> --model … --effort … --permission-mode auto --bg`) and reports the CLI's own session id. The decisions below are load-bearing.

## Cross-plugin naming

This file may name other plugins; the bats self-containment tripwire excludes `CLAUDE.md` and scans only `SKILL.md` and runtime files.

## Fork, not a call

- This skill is a deliberate fork of `coding-toolbox:dispatch-agent`, not a call into it — taskflow gains no cross-plugin dependency and keeps working without that plugin.
- Neither copy inherits the other's future fixes; that cost is accepted and permanent.
- Do not "deduplicate" by calling the other skill; the tripwire greps `skills/dispatch-task/` for any other plugin's name and must find none.

## Invocation and permissions

- `disable-model-invocation: true` — the skill launches an unattended `--permission-mode auto` session, so only an explicit user invocation may start one (`.claude/rules/skill-invocation-control.md`, "explicit reason" carve-out).
- `--permission-mode auto` is always forced.
- `allowed-tools` is bare `Bash`, not `Bash(claude:*)`:
  - Step 1 is a compound script (`set -e`, a `name="…-$(date +%s)-$RANDOM"` assignment, `[[ "$name" =~ … ]]`, then `claude … --bg`).
  - The Bash permission matcher requires every sub-command to be covered independently, so a narrow matcher never auto-approved the dispatch and it stalled with nobody present.
  - Task-text safety comes from the single-quoted heredoc, not the tool matcher, so widening adds no exposure.
- This skill's own Bash never touches `git`: `claude --worktree` starts a clean tree, which already satisfies `build-task`'s clean-`git status` precondition (the `git checkout -b` runs in the dispatched session).

## `--model=` / `--effort=`

- Same optional overrides as `coding-toolbox:dispatch-agent`; defaults `haiku` / `xhigh` (diverges from `dispatch-agent`'s `sonnet` default).
- The resolved values are validated against `^[A-Za-z0-9._-]+$` before substitution, so no override skips the check.

## Task text and heredoc

- The task text always travels inside a quoted heredoc read back by direct command substitution — no temp file, so a dispatch failing under `set -e` leaves nothing on disk.
- The delimiter is the fixed `DISPATCH_TASK_PROMPT_EOF`. Do not go back to a per-invocation "fresh delimiter":
  - The model had to write the invented token identically twice; any mismatch left the heredoc unterminated, so the command substitution broke and the job failed to start or launched with a mangled/empty prompt.
  - The residual risk (a task line exactly equal to the delimiter) is vanishingly unlikely and is the same one `coding-toolbox:dispatch-agent` accepts; the single-quoted heredoc already blocks shell expansion.

## Worktree base and branch cut

- `claude --worktree` bases the worktree on `origin/<default branch>` unless the project's `worktree.baseRef` setting (`settings.json`) is `"head"` (default `"fresh"`) — then on the dispatching session's own local `HEAD`, unpushed commits included. This also applies to `EnterWorktree` and subagent `isolation: worktree`.
- Never assume `"fresh"` in docs or `SKILL.md`; describe the conditional. Do not override the project's choice.
- Either way the worktree is checked out under an auto-generated branch NAME, never the base branch by name. `build-task` step 1 only cuts `feature/<slug>` when the current branch equals `BASE_BRANCH`, so the payload's first instruction is `git checkout -b "feature/<same-slug>"`, run by the dispatched session. The cut is required so `BRANCH_NAME` is already the pretty `feature/<slug>` name that `build-task` trusts verbatim.

## Unattended checkpoints

- `build-task` funnels every human decision through `AskUserQuestion`, so a dispatched run may pause with nobody present.
- The report step says so and points at `claude attach <id>`; the dispatched prompt is the bare command plus the task text, with no autonomy nudging.

## Why the payload passes `--skip-branch-check`

- `build-task` step 1 then skips its `git status --porcelain` clean check and its cut/switch-to-`feature/<slug>` logic, and trusts the checked-out branch (it still determines `BASE_BRANCH` and captures `BRANCH_NAME` on both paths; see `build-task/SKILL.md` step 1).
- The state is correct by construction: a clean worktree plus the payload's own `git checkout -b` before `build-task` runs.
- Under `--permission-mode auto` with nobody present, a redundant check risks a conflicting decision — a stop-and-report on a tree it misreads, or a second branch cut over dispatch-task's — with no one to intervene. An explicit caller flag removes the check instead of letting `build-task` second-guess state it cannot verify.
- No failure transcript backs this flag; it is a designed-against risk.
