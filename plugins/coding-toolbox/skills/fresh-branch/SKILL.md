---
name: fresh-branch
description: Use to start a fresh work branch off an optional custom base, or — with no arguments (or inside a linked git worktree) — fetch and rebase the current branch onto its base in place instead of switching branches. Auto-stashes and restores uncommitted changes around the operation.
argument-hint: "[branch-name|base] [base]"
allowed-tools: ["AskUserQuestion", "Bash(git:*)", "Bash(bash:*)"]
---

# Start or refresh a branch

With no arguments this skill always fetches and rebases the _current_ branch onto
the repo's default branch in place — no new branch is created, whether or not
you're in a worktree. With arguments, outside a git worktree it instead cuts a
brand-new branch off an up-to-date base (the default branch, or an explicit second
argument). Inside a **linked worktree**, a single argument is treated as an
explicit upstream/base to refresh onto instead of the default. Uncommitted changes
are stashed before either operation and popped afterward: in the newly created
branch when one is created, in place otherwise.

Parameter meaning depends on context (the script below detects it and validates
the argument count itself):

| Context      | Args | Meaning                                                  |
| ------------ | ---- | -------------------------------------------------------- |
| any          | 0    | fetch+rebase current branch onto the repo default branch |
| worktree     | 1    | fetch+rebase onto `$1` (explicit upstream/base)          |
| non-worktree | 1    | create branch `$1` off the repo default branch           |
| non-worktree | 2    | create branch `$1` off base `$2`                         |

Any explicit base — the worktree single argument (`$1`) or the non-worktree
second argument (`$2`) — is an **origin-tracked branch name**: it is resolved as
`origin/<name>` (fetch/pull/rebase). `fresh-branch` works with remote `origin`
only; "upstream" here means a base branch on `origin`, not a different git remote.

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification.

## Steps

1. Read `fresh-branch.reference.md` for the exact parameter and
   exit-code contract.
2. Run `bash ${CLAUDE_SKILL_DIR}/fresh-branch.sh <args...>` via the Bash
   tool, passing through the caller's original arguments unchanged (0,
   1, or 2 positional args — whatever was given).
3. Map the exit code per `fresh-branch.reference.md`'s table.
   - `6` `name_exists` — ask the user via `AskUserQuestion` — options
     **Switch to existing branch** (`git checkout <branch>`) / **Pick a
     different name** — then re-run step 2.
   - `8` `pop_conflict` — report explicitly that the stash is preserved
     (`git stash list`) for manual recovery; never say the operation
     fully succeeded without this caveat.
4. Report: the mode (`create` vs `refresh`), branch name, base, and
   commit from the script's printed lines.
