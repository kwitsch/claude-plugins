---
name: dispatch-agent
description: >-
  Syncs the current branch (fetch + fast-forward merge), then dispatches a new,
  worktree-isolated background Claude Code session (`claude --bg`, managed via `claude
  agents`) cut from the current branch's tip, handing it the prompt passed to this skill to
  execute unattended. Use to kick off further work without staying in this session to
  babysit it.
argument-hint: "[prompt-text]"
arguments: prompt
allowed-tools: ["Bash(git:*)", "Bash(claude:*)", "AskUserQuestion"]
---

# dispatch-agent

Hands off further work to a new, independent, worktree-isolated background Claude Code
session (`claude --bg`) — not an in-session `Agent`-tool subagent — seeded from the current
branch's tip after bringing it up to date.

`$prompt` is the instruction for the new background session, passed through unchanged. If
empty, ask via `AskUserQuestion` (2-3 illustrative example prompts as options; the real one
arrives via "Other") before doing anything else. Never guess.

Only **committed** state (HEAD) carries over into the dispatched session — uncommitted or
staged changes in the current working tree do not. If you have WIP the new session should
continue, commit it first.

## Steps

1. **Sync the current branch.**

   ```bash
   git fetch origin || { echo "fetch failed"; exit 1; }
   if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
     git merge --ff-only @{u} || { echo "merge failed — branch has diverged from its upstream"; exit 1; }
   fi
   ```

   A freshly-cut branch commonly has no upstream yet — that's not a failure, just nothing to
   merge. `git merge --ff-only @{u}` (not `git pull`) avoids a second, redundant fetch — the
   explicit `git fetch origin` above already refreshed the remote-tracking ref. Any reported
   failure stops here; do not continue to step 2 on a branch that didn't sync cleanly.

2. **Create the worktree and dispatch the background session — one Bash call.** Separate
   Bash tool invocations don't share shell state (the generated worktree name would be lost
   between calls), and `$prompt` is a skill _argument_, not a shell variable — it must be
   substituted as literal text, not referenced as `"$prompt"`. Both are solved by doing
   everything in a single call, with the actual prompt text embedded verbatim inside a
   quoted heredoc, read back via direct command substitution (no intermediate temp file to
   leak on a failed dispatch):

   ```bash
   set -e
   repo_root="$(realpath "$(git rev-parse --git-common-dir)/..")"
   name="dispatch-<3-6-word-english-slug-of-the-prompt>-$(date +%s)"
   git worktree add -b "$name" "$repo_root/.claude/worktrees/$name" HEAD
   (cd "$repo_root/.claude/worktrees/$name" && claude --bg "$(cat <<'DISPATCH_AGENT_PROMPT_EOF'
   <the literal, verbatim prompt text goes here — the actual argument value, not the string
   "$prompt" — substituted by you when you write this command, exactly as given>
   DISPATCH_AGENT_PROMPT_EOF
   )")
   ```

   Before writing this command, derive `<3-6-word-english-slug-of-the-prompt>` yourself —
   summarize `$prompt` in 3-6 English words, lowercase, non-alphanumeric runs collapsed to a
   single `-` (same convention as `fresh-work`'s own branch-naming step) — and substitute the
   literal slug into `name=`, same as the heredoc's literal prompt text. The trailing
   `$(date +%s)` still guarantees uniqueness even if two dispatches summarize to the same
   slug.

   `repo_root` anchors on the **primary checkout**, not the invoking worktree — `git
rev-parse --git-common-dir` always resolves to the shared `.git` regardless of which
   worktree you're in, so every dispatched worktree lands as a sibling under the primary
   checkout's `.claude/worktrees/`, never nested inside whichever worktree happened to invoke
   this skill. `set -e` stops the whole block on the first failure (`git worktree add` — name
   collision; `claude --bg` — binary missing, launch failure) so Claude sees a non-zero exit
   and can report it, rather than silently continuing past a broken step. On failure, report
   the error as-is — never retry with `--force`, and if `git worktree add` already succeeded
   before a later command failed, leave that worktree in place (don't auto-remove it; the
   user may want to inspect it or retry the dispatch from it).

   Deliberately not `claude --worktree`/`EnterWorktree` for the worktree itself, and
   necessarily a **new branch** rather than a continuation of the current one — see
   `coding-toolbox/CLAUDE.md`'s "Skill design (`dispatch-agent`)" section for why (verified
   empirically, not repeated here). No `--permission-mode` override on `claude --bg` — the
   default does not stall on tool-use approval for background sessions (verified).

3. **Report.** Relay the CLI's own printed session id and management hints verbatim (`claude
agents`, `claude attach <id>`, `claude logs <id>`, `claude stop <id>`), plus the new branch
   name and worktree path from step 2. State plainly: this is a _new_ branch cut from the
   current one's tip, not a continuation of it, and that removing the worktree afterward is
   `git worktree remove <path>` (`claude rm <id>` alone releases the CLI's own job-state
   tracking but does not remove a worktree this skill created by hand).
