---
name: dispatch-agent
description: >-
  Syncs the current branch (fetch + fast-forward pull), then dispatches a new,
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

## Steps

1. **Sync the current branch.**

   ```bash
   git fetch origin
   if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
     git pull --ff-only || { echo "pull failed — branch has diverged from its upstream"; exit 1; }
   fi
   ```

   A freshly-cut branch commonly has no upstream yet — that's not a failure, just nothing to
   pull. Any reported failure (fetch error, non-fast-forward) stops here; do not continue to
   step 2 on a branch that didn't sync cleanly.

2. **Create the worktree and dispatch the background session — one Bash call.** Separate
   Bash tool invocations don't share shell state (the generated worktree name would be lost
   between calls), and `$prompt` is a skill _argument_, not a shell variable — it must be
   substituted as literal text, not referenced as `"$prompt"`. Both are solved by doing
   everything in a single call, with the actual prompt text embedded verbatim inside a
   quoted heredoc (so its content is never shell-expanded, however it happens to be
   punctuated):

   ```bash
   set -e
   repo_root="$(git rev-parse --show-toplevel)"
   name="dispatch-$(date +%s)"
   git worktree add -b "$name" "$repo_root/.claude/worktrees/$name" HEAD
   promptfile="$(mktemp)"
   cat > "$promptfile" <<'DISPATCH_AGENT_PROMPT_EOF'
   <the literal, verbatim prompt text goes here — the actual argument value, not the string
   "$prompt" — substituted by you when you write this command, exactly as given>
   DISPATCH_AGENT_PROMPT_EOF
   (cd "$repo_root/.claude/worktrees/$name" && claude --bg "$(cat "$promptfile")")
   rm -f "$promptfile"
   ```

   `git rev-parse --show-toplevel` anchors on the current worktree's own root (not
   necessarily the primary checkout) — matches how the CLI's own `--worktree` flag places
   things, confirmed empirically. `set -e` stops the whole block on the first failure
   (`git worktree add` — name collision, dirty state; `claude --bg` — binary missing, launch
   failure) so Claude sees a non-zero exit and can report it, rather than silently
   continuing past a broken step. On failure, report the error as-is — never retry with
   `--force`, and if `git worktree add` already succeeded before a later command failed,
   leave that worktree in place (don't auto-remove it; the user may want to inspect it or
   retry the dispatch from it).

   Deliberately **not** `claude --worktree`/`EnterWorktree` for the worktree itself — both
   base a new worktree off `origin/<default-branch>`, not the current branch (verified; see
   `coding-toolbox/CLAUDE.md`'s "Skill design (`dispatch-agent`)" section). `git worktree add`
   also cannot check out the _same_ branch name in two worktrees at once, so this is
   necessarily a **new branch**, cut from the current branch's exact tip — its content is
   identical to "current branch as base" at this moment; only the name differs. The
   dispatched session's work will need merging back later. No `--permission-mode` override on
   `claude --bg` — the default does not stall on tool-use approval for background sessions
   (verified).

3. **Report.** Relay the CLI's own printed session id and management hints verbatim (`claude
agents`, `claude attach <id>`, `claude logs <id>`, `claude stop <id>`), plus the new branch
   name and worktree path from step 2. State plainly: this is a _new_ branch cut from the
   current one's tip, not a continuation of it, and that removing the worktree afterward is
   `git worktree remove .claude/worktrees/<name>` (`claude rm <id>` alone releases the CLI's
   own job-state tracking but does not remove a worktree this skill created by hand).
