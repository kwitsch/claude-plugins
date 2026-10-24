---
name: dispatch-cc-references-update
description: >-
  Kicks off the update-cc-references refresh of the cc-knowledge reference files in a new,
  worktree-isolated background Claude Code session (`claude --worktree ... --bg`, model
  `haiku`, effort `high`, both fixed and not overridable) — so the current session does not
  have to stay and babysit the run. The dispatched session refreshes, verifies, patch-bumps
  cc-knowledge and opens the PR on its own.
argument-hint: "[skills|agents|hooks|commands|mcp|plugins|memory|settings|all]"
allowed-tools: ["Bash"]
disable-model-invocation: true
---

# dispatch-cc-references-update

Hands one `update-cc-references` refresh to a new, worktree-isolated background Claude Code
session (`claude --worktree ... --bg`) that runs unattended — a separate session, not an
in-session subagent. Model `haiku` and effort `high` are fixed in the launch command; this
skill has no way to override either. The worktree starts on an auto-generated branch name, so
the payload has the new session cut a named `fix/refresh-cc-references-<target>-<YYYYMMDD>`
branch first: `update-cc-references` Release step 4's inline git fallback only cuts a branch "if
currently on the default branch". This skill's own Bash never runs `git`. It is a deliberate
fork of taskflow's `dispatch-task`; the design rationale lives in
[dispatch-task/CLAUDE.md](../../../plugins/taskflow/skills/dispatch-task/CLAUDE.md).

The argument text this skill was invoked with, trimmed, is `target`; empty means `target=all`. `target` must be exactly one of
`skills agents hooks commands mcp plugins memory settings all`, matched case-sensitively as a
single token. Any other value — multiple words, or any token starting with `--` (there are no
flags) — stops the skill: report the valid set. Never guess, sanitize or ask.

## Step 1: Dispatch the background session

One Bash call. Substitute only the validated `<target>` token — it occurs three times: once in
`name`, and twice in the payload (the branch name and the `/update-cc-references` argument).

```bash
set -e
name="cc-refs-update-<target>-$(date +%s)-$RANDOM"
[[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "unsafe dispatch name: $name" >&2
  exit 1
}
((${#name} <= 64)) || {
  echo "worktree name too long (${#name} chars, max 64): $name" >&2
  exit 1
}
claude --worktree "$name" --model haiku --effort high --permission-mode auto --bg "$(
  cat << 'DISPATCH_CC_REFERENCES_PROMPT_EOF'
First, in this fresh worktree (already a clean checkout), run exactly this before
anything else:
  git checkout -b "fix/refresh-cc-references-<target>-$(date +%Y%m%d)"
Then invoke:
/update-cc-references <target>
DISPATCH_CC_REFERENCES_PROMPT_EOF
)"
```

- **Fixed model/effort.** `haiku` and `high` are literal tokens in the command; nothing is
  substituted or validated for them. `haiku` is a bare alias (only the Opus tier is pinned).
- **Name budget.** `cc-refs-update-` is 15 chars; with `-`, a 10-digit epoch, `-` and up to 5
  `$RANDOM` digits that is 32 chars of fixed overhead, so the longest target (`commands` or
  `settings`, 8 chars) gives at most 40 — safely under the 64-char limit `claude --worktree`
  enforces. The script keeps both checks anyway as defense in depth (the same block
  `dispatch-task` uses).
- **Heredoc.** It is single-quoted with the fixed delimiter named in the script above, so this
  shell expands nothing. The date command inside the payload is literal text: the dispatched
  session expands it when it runs the branch cut, giving a date-suffixed branch that avoids
  colliding with a previous run's local branch (worktrees share refs).
- **Branch prefix.** `fix/` matches `update-cc-references`' commit subject
  `fix(cc-knowledge): refresh CC reference files`.
- **Invocation form.** `/update-cc-references` is unnamespaced (it is a project skill) and
  user-only, so it must reach the new session as a typed slash command in the prompt.
- **Permission mode.** `--permission-mode auto` is always set — nobody is present to approve
  tool calls.
- **Failure.** On any failure (name collision, `claude` missing, launch failure, or a same-day
  branch that already exists inside the dispatched session), report the error as-is. Never
  retry with `--force`.

## Step 2: Report

Relay the CLI's own printed session id and management hints verbatim (`claude agents`,
`claude attach <id>`, `claude logs <id>`, `claude stop <id>`, `claude rm <id>` — this last one
removes the worktree too, since `claude --worktree` owns it), plus the target used and the
fixed model (`haiku`) and effort (`high`). State plainly that:

- (a) the worktree started from the repository's default branch on origin, unless this project
  has `worktree.baseRef` set to `"head"`, in which case it started from this session's own
  current HEAD;
- (b) the dispatched transcript (`claude logs <id>` / `claude attach <id>`) is the only result
  channel;
- (c) `update-cc-references` ends without a commit or PR when the references are already
  current — by design;
- (d) an unresolvable doc fetch is a hard stop that is visible only in that transcript;
- (e) a permission or interactive pause needs `claude attach <id>`.
