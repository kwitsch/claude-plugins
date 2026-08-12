---
name: dispatch-task
description: >-
  Kicks off this plugin's build-task pipeline for a described task in a new,
  worktree-isolated background Claude Code session (`claude --worktree ... --bg`, model
  `sonnet`, effort `medium`) cut from the repository's default branch on origin — so the
  current session does not have to stay and babysit the run. Use to hand off a full
  design-and-delivery task and keep working. Self-contained: depends on no other plugin.
argument-hint: "[task-description]"
arguments: task_description
allowed-tools: ["Bash(claude:*)", "AskUserQuestion"]
disable-model-invocation: true
---

# dispatch-task

Hands one described task to a new, worktree-isolated background Claude Code session
(`claude --worktree ... --bg`) that runs this plugin's `build-task` pipeline unattended —
not an in-session subagent of this conversation. The dispatched session's worktree is
branched off the repository's **default branch on origin** (`claude --worktree` always
creates it that way), but checked out on an auto-generated branch NAME, not literally that
default branch — so nothing about the current session's own branch or sync state affects
the dispatch, but the payload below has the new session cut a properly-named
`feature/<slug>` branch as its own first action, before invoking `build-task`; skipping that
would make `build-task`'s step 1 ("otherwise, stay on the current branch") fire on every
dispatch and ship from the ugly auto-generated branch instead. This skill's own Bash calls
still never touch `git` — that first action runs inside the new session, not here.

`$task_description` is the whole task text — there are no flags to parse: model
(`sonnet`) and effort (`medium`) are fixed constants here. If `$task_description` is
empty after trimming, ask via `AskUserQuestion` (2-3 illustrative example task
descriptions as options; the real one arrives via "Other") before doing anything else.
Never guess a task.

## Steps

1. **Dispatch the background session.** Derive a short (3-6 English words, lowercase,
   non-alphanumeric runs collapsed to a single `-`) slug from the task text yourself —
   reuse the exact same slug both for the session name below and for the `feature/<slug>`
   branch the payload cuts. Any value you interpolate into the command below must match
   `^[A-Za-z0-9._-]+$` — safe bare tokens only, no quotes, `$()`, backticks, or whitespace;
   the fixed `sonnet`/`medium` constants satisfy that trivially, and any future override
   would have to pass the same check before substitution. The script itself re-checks
   `$name` against that same pattern before it is ever passed to `claude` — never rely on
   the slug you derived alone.

   Before writing the command, read the whole task text and pick a **fresh heredoc
   delimiter for this invocation** — never reuse a fixed literal like
   `DISPATCH_TASK_PROMPT_EOF` across dispatches. Choose a token (≥20 characters, letters
   and digits) that does not appear anywhere in the task text, verified by your own
   reading of it, not assumed. This is what keeps a task description from ever breaking
   out of the heredoc: a fixed, predictable terminator is the only way that could happen,
   and a fresh one chosen against the actual text closes it completely, not just makes it
   less likely.

   Then embed the task text verbatim inside the quoted heredoc (never shell-expanded,
   whatever it is punctuated with), all in one Bash call:

   ```bash
   set -e
   name="taskflow-build-<3-6-word-english-slug-of-the-task>-$(date +%s)-$RANDOM"
   [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || {
     echo "unsafe dispatch name: $name" >&2
     exit 1
   }
   claude --worktree "$name" --model "sonnet" --effort "medium" --permission-mode auto --bg "$(
     cat << 'DISPATCH_TASK_PROMPT_<fresh-collision-free-token-here>'
   First, in this fresh worktree (already a clean checkout branched off the repository's
   default branch), run exactly this before anything else:
     git checkout -b "feature/<same-3-6-word-english-slug-as-above>"
   Then invoke:
   /taskflow:build-task <the literal, verbatim task description text goes here —
   substituted by you when you write this command, exactly as given, never the string
   "$task_description">
   DISPATCH_TASK_PROMPT_<fresh-collision-free-token-here>
   )"
   ```

   `--permission-mode auto` is always set explicitly, unconditionally — the dispatched
   session has nobody present to answer an interactive tool-use approval prompt.
   `$(date +%s)-$RANDOM` combines a wall-clock timestamp with bash's own random builtin,
   so two same-second dispatches of the same task still get distinct names. The prompt is
   read back with direct command substitution — no temp file, so a dispatch that fails
   under `set -e` leaves nothing on disk to leak. The payload's actual task instruction is
   exactly `/taskflow:build-task <task text>`: that skill binds the whole remainder of the
   line to its own task-description argument verbatim, and — already on the correctly
   named `feature/<slug>` branch by the time it runs — stays there per its own step 1 and
   ships on its own. On failure (name collision, invalid `--model`/`--effort` value,
   `claude` binary missing, launch failure, or the preliminary `git checkout -b` failing
   because that branch name is already taken), report the error as-is — never retry with
   `--force`.

2. **Report.** Relay the CLI's own printed session id and management hints verbatim
   (`claude agents`, `claude attach <id>`, `claude logs <id>`, `claude stop <id>`,
   `claude rm <id>` — this last one removes the worktree too, since `claude --worktree`
   owns it), plus the model (`sonnet`) and effort (`medium`) used. State plainly that
   (a) the dispatched session started from the repository's default branch on origin, not
   this session's branch, (b) that session's own transcript is the only result channel
   (`claude logs <id>` / `claude attach <id>`) — `build-task` ends with a prose report,
   not a structured payload this skill can capture — and (c) `build-task` funnels its
   human checkpoints through `AskUserQuestion`, so an unattended run may pause at one
   until you attach to that session and answer it.
