---
name: dispatch-task
description: >-
  Kicks off this plugin's build-task pipeline for a described task in a new,
  worktree-isolated background Claude Code session (`claude --worktree ... --bg`, model
  `sonnet`, effort `xhigh` by default, both overridable via optional `--model=`/`--effort=`
  flags) — so the current session does not have to stay and babysit the run. Use to hand off
  a full design-and-delivery task and keep working. Self-contained: depends on no other plugin.
argument-hint: "[--model=<model>] [--effort=<effort>] [task-description]"
arguments: task_description
allowed-tools: ["Bash", "AskUserQuestion"]
disable-model-invocation: true
---

# dispatch-task

Hands one described task to a new, worktree-isolated background Claude Code session
(`claude --worktree ... --bg`) that runs this plugin's `build-task` pipeline unattended —
not an in-session subagent of this conversation. The dispatched session's worktree branches
from the repository's **default branch on origin** — UNLESS this project's `worktree.baseRef`
setting is `"head"` (not the default `"fresh"`), in which case it instead branches from
_this session's own current local `HEAD`_, carrying this session's unpushed commits and
feature-branch state into the dispatched run. Either way it is checked out on an
auto-generated branch NAME, never literally the default branch or this session's branch by
name — so the payload below has the new session cut a properly-named `feature/<slug>`
branch as its own first action, before invoking `build-task`, regardless of which base it
started from. The payload also passes `--skip-branch-check` to `build-task`, so its
step 1 trusts the freshly-cut `feature/<slug>` branch outright and skips its own
clean-tree check and branch cut — instead of `build-task` comparing the branch name
against the base and falling through to its "stay on the current branch" path. Cutting
the branch first is still required so that name is already the pretty `feature/<slug>`
build-task now trusts verbatim. This skill's own Bash calls still never touch `git` —
that first action runs inside the new session, not here.

`$task_description` may optionally start with `--model=<model>` and/or `--effort=<effort>`
(any order, whitespace-separated) — parse and strip these before anything else; default
`model` to `sonnet` and `effort` to `xhigh` when either is not given. Whatever remains
(trimmed) is the actual task text. If that task text is empty after trimming, ask via
`AskUserQuestion` (2-3 illustrative example task descriptions as options; the real one
arrives via "Other") before doing anything else. Never guess a task.

## Steps

1. **Dispatch the background session.** Derive a short (3-6 English words, lowercase,
   non-alphanumeric runs collapsed to a single `-`) slug from the task text (after stripping
   any `--model=`/`--effort=` prefix) yourself — reuse the exact same slug both for the
   session name below and for the `feature/<slug>` branch the payload cuts. `claude --worktree`
   rejects any name over 64 chars total, so the slug itself has a hard budget: the fixed
   template `taskflow-build-<slug>-$(date +%s)-$RANDOM` burns `taskflow-build-` (15 chars) +
   `-` + a 10-digit epoch + `-` + up to 5 `$RANDOM` digits (17 more chars) = 32 chars of
   fixed overhead, leaving **at most 32 characters for the slug itself** — keep it well
   under that (e.g. 3-4 short words) rather than pushing right up against the limit.
   Before building the command below, validate the resolved `model` and `effort` values
   (whether parsed from `--model=`/`--effort=` or the `sonnet`/`xhigh` defaults) match
   `^[A-Za-z0-9._-]+$` — safe bare tokens only, no quotes, `$()`, backticks, or whitespace.
   Either one failing this check → stop and report; never substitute an unvalidated value
   into the command below, and never strip/sanitize it yourself. The script itself re-checks
   `$name` against that same pattern, and separately rejects it outright if it is still over
   64 chars total, before it is ever passed to `claude` — never rely on the slug you derived
   alone.

   The task text is embedded inside a **single-quoted** heredoc, so nothing in it is ever
   shell-expanded or interpolated, whatever it is punctuated with. Use the fixed delimiter
   `DISPATCH_TASK_PROMPT_EOF`. The single-quoted terminator plus a literal payload is
   exactly what the proven `claude --worktree … --bg` dispatch pattern relies on; the only
   residual way a task could escape is if it contained the line `DISPATCH_TASK_PROMPT_EOF`
   verbatim, on its own line — vanishingly unlikely, and not worth trading against the
   reliability of a fixed, always-matching terminator you no longer have to invent and
   reproduce identically in two places.

   Then embed the task text verbatim inside the quoted heredoc (never shell-expanded,
   whatever it is punctuated with), all in one Bash call:

   ```bash
   set -e
   name="taskflow-build-<3-6-word-english-slug-of-the-task>-$(date +%s)-$RANDOM"
   [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || {
     echo "unsafe dispatch name: $name" >&2
     exit 1
   }
   ((${#name} <= 64)) || {
     echo "worktree name too long (${#name} chars, max 64): $name" >&2
     exit 1
   }
   claude --worktree "$name" --model "<validated-model>" --effort "<validated-effort>" --permission-mode auto --bg "$(
     cat << 'DISPATCH_TASK_PROMPT_EOF'
   First, in this fresh worktree (already a clean checkout), run exactly this before
   anything else:
     git checkout -b "feature/<same-3-6-word-english-slug-as-above>"
   Then invoke:
   /taskflow:build-task --skip-branch-check <the literal, verbatim task text goes here — the actual task after
   stripping any --model=/--effort= prefix, not the raw string "$task_description" —
   substituted by you when you write this command, exactly as given>
   DISPATCH_TASK_PROMPT_EOF
   )"
   ```

   `--permission-mode auto` is always set explicitly, unconditionally — the dispatched
   session has nobody present to answer an interactive tool-use approval prompt.
   `$(date +%s)-$RANDOM` combines a wall-clock timestamp with bash's own random builtin,
   so two same-second dispatches of the same task still get distinct names. The prompt is
   read back with direct command substitution — no temp file, so a dispatch that fails
   under `set -e` leaves nothing on disk to leak. The payload's actual task instruction is
   exactly `/taskflow:build-task --skip-branch-check <task text>`: that skill binds the whole
   remainder of the line (after the flag) to its own task-description argument verbatim, and —
   because `--skip-branch-check` is passed — skips its own step 1 branch check entirely,
   trusting the `feature/<slug>` branch this skill just cut rather than re-deriving or
   comparing it. On failure (name collision, invalid `--model`/`--effort` value,
   `claude` binary missing, launch failure, or the preliminary `git checkout -b` failing
   because that branch name is already taken), report the error as-is — never retry with
   `--force`.

2. **Report.** Relay the CLI's own printed session id and management hints verbatim
   (`claude agents`, `claude attach <id>`, `claude logs <id>`, `claude stop <id>`,
   `claude rm <id>` — this last one removes the worktree too, since `claude --worktree`
   owns it), plus the model/effort actually used. State plainly that
   (a) the dispatched session's worktree started from the repository's default branch on
   origin, unless this project has `worktree.baseRef` set to `"head"`, in which case it
   started from this session's own current HEAD instead, (b) that session's own transcript
   is the only result channel
   (`claude logs <id>` / `claude attach <id>`) — `build-task` ends with a prose report,
   not a structured payload this skill can capture — and (c) `build-task` funnels its
   human checkpoints through `AskUserQuestion`, so an unattended run may pause at one
   until you attach to that session and answer it.
