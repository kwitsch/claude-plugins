---
name: dispatch-agent
description: >-
  Dispatches a new, worktree-isolated background Claude Code session (`claude --worktree ...
  --bg`, managed via `claude agents`) — cut from the repository's default branch on origin
  unless the project's `worktree.baseRef` is `"head"` (then from this session's own local
  `HEAD`) — handing it the prompt passed to this skill to execute unattended. Use to kick off
  an independent background task without staying in this session to babysit it.
argument-hint: "[--model=<model>] [--effort=<effort>] <prompt-text>"
arguments: prompt
allowed-tools: ["Bash", "AskUserQuestion"]
---

# dispatch-agent

Hands off an independent task to a new, worktree-isolated background Claude Code session
(`claude --worktree ... --bg`) — not an in-session `Agent`-tool subagent. The dispatched
session's worktree branches from the repository's **default branch on origin** — UNLESS this
project's `worktree.baseRef` setting is `"head"` (not the default `"fresh"`), in which case it
instead branches from _this session's own current local `HEAD`_, carrying this session's
unpushed commits and feature-branch state into the dispatched run (verified; see
`coding-toolbox/CLAUDE.md`'s "Skill design (`dispatch-agent`)" section). This skill works with
whichever base `worktree.baseRef` selects instead of fighting it: it runs no pre-dispatch sync
and has no local-branch prerequisite step — it never touches `git` and takes that base as-is.
Under the default `"fresh"` base the current branch's own sync state is irrelevant to what the
dispatched session starts from; under `"head"` the session instead starts from this session's
current local `HEAD` exactly as it is now.

`$prompt` may optionally start with `--model=<model>` and/or `--effort=<effort>` (any order,
whitespace-separated) — parse and strip these before anything else; default `model` to
`sonnet` and `effort` to `xhigh` when either is not given. Whatever remains (trimmed) is the
actual instruction for the new background session. If that's empty, ask via `AskUserQuestion`
(2-3 illustrative example prompts as options; the real one arrives via "Other") before doing
anything else. Never guess.

## Steps

1. **Dispatch the background session.** Derive a short (3-6 English words, lowercase,
   non-alphanumeric runs collapsed to a single `-`) slug from the actual prompt (after
   stripping any `--model=`/`--effort=` prefix) yourself — same convention as `fresh-work`'s
   own branch-naming step. `claude --worktree` rejects any name over 64 chars total, so the
   slug has a hard budget: the fixed template `dispatch-<slug>-$(date +%s)-$RANDOM` burns
   `dispatch-` (9 chars) + `-` + a 10-digit epoch + `-` + up to 5 `$RANDOM` digits (17 more
   chars) = 26 chars of fixed overhead, leaving **at most 38 characters for the slug
   itself** — keep it well under that (e.g. 3-4 short words) rather than pushing right up
   against the limit. Before building the command below, validate the resolved `model`
   and `effort` values (whether parsed from `--model=`/`--effort=` or the `sonnet`/`xhigh`
   defaults) match `^[A-Za-z0-9._-]+$` — safe bare tokens only, no quotes, `$()`, backticks,
   or whitespace. Either one fails this check → stop and report; never substitute an
   unvalidated value into the command below, and never strip/sanitize it yourself. Then embed
   the actual prompt text verbatim inside a quoted heredoc (never shell-expanded, whatever
   it's punctuated with), all in one Bash call:

   ```bash
   set -e
   name="dispatch-<3-6-word-english-slug-of-the-prompt>-$(date +%s)-$RANDOM"
   [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || {
     echo "unsafe dispatch name: $name" >&2
     exit 1
   }
   ((${#name} <= 64)) || {
     echo "worktree name too long (${#name} chars, max 64): $name" >&2
     exit 1
   }
   claude --worktree "$name" --model "<validated-model>" --effort "<validated-effort>" --permission-mode auto --bg "$(
     cat << 'DISPATCH_AGENT_PROMPT_EOF'
   <the literal, verbatim prompt text goes here — the actual instruction after stripping any
   --model=/--effort= prefix, not the string "$prompt" — substituted by you when you write
   this command, exactly as given>
   DISPATCH_AGENT_PROMPT_EOF
   )"
   ```

   `<validated-model>`/`<validated-effort>` are the values that just passed the character-class
   check above — safe to place directly inside double quotes since that check rules out any
   shell metacharacter that could otherwise break out of them. `--permission-mode auto` is
   always set explicitly — the dispatched session must never stall on interactive tool-use
   approval with nobody there to answer it. `$(date +%s)-$RANDOM` combines a wall-clock
   timestamp with bash's own random-number builtin so two same-second dispatches of the same
   prompt still get distinct names. On failure (name collision, invalid `--model`/`--effort`
   value, `claude` binary missing, launch failure), report the error as-is — never retry with
   `--force`.

2. **Report.** Relay the CLI's own printed session id and management hints verbatim (`claude
agents`, `claude attach <id>`, `claude logs <id>`, `claude stop <id>`, `claude rm <id>` —
   this last one now fully removes the worktree too, since `claude --worktree` owns it), plus
   the model/effort actually used. State plainly: the dispatched session's worktree started
   from the repository's default branch on origin, unless this project has `worktree.baseRef`
   set to `"head"`, in which case it started from this session's own current HEAD instead.
