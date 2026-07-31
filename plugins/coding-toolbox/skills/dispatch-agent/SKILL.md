---
name: dispatch-agent
description: >-
  Syncs the current branch (fetch + fast-forward merge), then dispatches a new,
  worktree-isolated background Claude Code session (`claude --worktree ... --bg`, managed via
  `claude agents`) — cut from the repository's default branch on origin, not the current
  branch — handing it the prompt passed to this skill to execute unattended. Use to kick off
  an independent background task without staying in this session to babysit it.
argument-hint: "[prompt-text]"
arguments: prompt
allowed-tools: ["Bash(git:*)", "Bash(claude:*)", "AskUserQuestion"]
---

# dispatch-agent

Hands off an independent task to a new, worktree-isolated background Claude Code session
(`claude --worktree ... --bg`) — not an in-session `Agent`-tool subagent. The dispatched
session starts from the repository's **default branch on origin**, not the current branch —
`claude --worktree` always creates its worktree that way (verified; see
`coding-toolbox/CLAUDE.md`'s "Skill design (`dispatch-agent`)" section), so this skill works
with that instead of fighting it.

`$prompt` is the instruction for the new background session, passed through unchanged. If
empty, ask via `AskUserQuestion` (2-3 illustrative example prompts as options; the real one
arrives via "Other") before doing anything else. Never guess.

## Steps

1. **Sync the current branch.** Independent housekeeping — the dispatched session in step 2
   does not use this branch, but leaving it stale would be a surprise the next time you come
   back to it.

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

2. **Dispatch the background session.** Derive a short (3-6 English words, lowercase,
   non-alphanumeric runs collapsed to a single `-`) slug from `$prompt` yourself — same
   convention as `fresh-work`'s own branch-naming step — and embed the actual prompt text
   verbatim inside a quoted heredoc (never shell-expanded, whatever it's punctuated with), all
   in one Bash call:

   ```bash
   set -e
   name="dispatch-<3-6-word-english-slug-of-the-prompt>-$(date +%s)"
   claude --worktree "$name" --bg "$(cat <<'DISPATCH_AGENT_PROMPT_EOF'
   <the literal, verbatim prompt text goes here — the actual argument value, not the string
   "$prompt" — substituted by you when you write this command, exactly as given>
   DISPATCH_AGENT_PROMPT_EOF
   )"
   ```

   The `$(date +%s)` suffix guarantees uniqueness even if two dispatches summarize to the same
   slug. No `--permission-mode` override — the default does not stall on tool-use approval for
   background sessions (verified). On failure (name collision, `claude` binary missing,
   launch failure), report the error as-is — never retry with `--force`.

3. **Report.** Relay the CLI's own printed session id and management hints verbatim (`claude
agents`, `claude attach <id>`, `claude logs <id>`, `claude stop <id>`, `claude rm <id>` —
   this last one now fully removes the worktree too, since `claude --worktree` owns it).
   State plainly: the dispatched session started from the repo's default branch on origin,
   not the branch this session is on.
