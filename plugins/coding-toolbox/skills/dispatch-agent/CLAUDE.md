# CLAUDE.md — coding-toolbox skill: dispatch-agent

## Skill design (`dispatch-agent`)

Single-step skill, no extracted script (`skills/dispatch-agent/SKILL.md` only): dispatch a
real, independent, worktree-isolated background Claude Code session (`claude --worktree <name>
--bg`, tracked via `claude agents`/`claude logs`/`claude attach`/`claude stop`/`claude rm`) —
not the in-session `Agent` tool, which the user explicitly rejected during design (it
dispatches a subagent of the current conversation, not a separate session).

**Third design revision: dropped the pre-dispatch "sync the current branch" step entirely**
(`git fetch origin` + `git merge --ff-only @{u}`, previously step 1). It never fed the dispatch
— `claude --worktree` bases every new worktree off `origin/<default-branch>`, never the current
branch, so the sync's only effect was a side benefit: keeping the _current_ session's branch
from going stale. Asked directly whether to keep that side benefit or simplify to a single
step, the user chose to remove it — this narrows the skill to exactly what dispatch requires,
at the cost of that no-longer-automatic freshening (a plain `fresh-branch` covers it when
wanted). `allowed-tools` lost its `Bash(git:*)` grant along with it — nothing left in this
skill calls `git`.

**`worktree.baseRef` (documented, not overridden).** `claude --worktree`'s base is controlled
by the project's `worktree.baseRef` setting (`settings.json`), default `"fresh"` (branch off
the repo's default branch on `origin`); `"head"` branches every new worktree (`--worktree`,
`EnterWorktree`, subagent `isolation: worktree`) from local `HEAD` where it runs, carrying
unpushed commits/feature-branch state. This skill does not and should not override that
project-level choice — it only documents the conditional accurately (this doc and `SKILL.md`
used to claim the default-branch base unconditionally). The dispatch script now also
regex-guards `$name` against `^[A-Za-z0-9._-]+$` before the length check, mirroring
`dispatch-task`'s own worktree-name validation.

**Second design revision (post-ship, same PR): switched from a hand-created worktree back to
the native `claude --worktree` flag, deliberately giving up "current branch as base."** The
first cut (see git history on this file/PR for the superseded prose) rejected `--worktree`
because it bases a new worktree off `origin/<default-branch>`, not the current branch — smoke-tested
and confirmed — and hand-rolled `git worktree add -b <name> <path> HEAD` instead, anchored on
the primary checkout (`realpath "$(git rev-parse --git-common-dir)/..")`) to avoid nesting.
Asked directly whether to keep that base-branch-preserving hand-roll or simplify onto the
native flag and accept `origin/<default-branch>` as the dispatched session's base, the user
chose the latter. This is a **recorded decision reversal**, not a bug fix — a future editor
re-introducing manual `git worktree add` "to fix the wrong base branch" would be undoing an
explicit choice, not restoring one. Upside of the reversal: `claude --worktree` already places
new worktrees as siblings under the primary checkout (verified — no nesting issue even from
inside another worktree), and a worktree it creates is tracked by the CLI's own job-state, so
`claude rm <id>` now fully removes it (unlike a hand-created one, which needed a separate `git
worktree remove`).

The prompt is embedded verbatim inside a quoted heredoc and read back via direct command
substitution (`"$(cat <<'EOF' … EOF)"`, no intermediate temp file) — so arbitrary **prompt**
content can't break the command (the heredoc's quoted delimiter is what buys this; it says
nothing about other values substituted elsewhere in the same command — see the `--model`/
`--effort` validation note below), and there's nothing left on disk to leak if the dispatch
fails after the heredoc is written (an earlier draft wrote the prompt to a `mktemp` file
first; under `set -e` a failing dispatch skipped the cleanup `rm -f`, leaking the prompt to
disk on every failed dispatch — fixed by removing the intermediate file entirely rather than
adding a `trap`). The worktree/session name still composes a 3-6-English-word slug of the
prompt (same convention as `fresh-work`'s own branch-naming step) with a `$(date +%s)-$RANDOM`
suffix for uniqueness (CodeRabbit finding, PR #156: a bare `$(date +%s)` alone only resolves to
the second, so two same-second dispatches of the same prompt would collide; `$RANDOM` closes
that gap without adding retry logic) — a bare timestamp was also readable only by attaching to
each session to read its prompt. `allowed-tools` carries `Bash`/`AskUserQuestion` only — no
`Agent`, no `Skill`. It was **widened from the old narrow `Bash(claude:*)` to bare `Bash` on
2026-08-19**: step 1's Bash call is a compound script (`set -e`, a
`name="…-$(date +%s)-$RANDOM"` assignment whose command substitution is not a known-safe
leading assignment, then `claude … --bg`), and the permission matcher splits on separators and
requires every sub-command to be covered independently (`.claude/rules` → the settings
reference's "Per-tool specifiers": "matches each subcommand independently") — so
`Bash(claude:*)` alone never auto-approved the dispatch, and it stalled on a permission prompt
(or was denied) with nobody present to answer. An earlier revision of this doc called that
stall "an accepted consequence of the narrow allowed-tools list, not a gap to fix by widening
it"; that stance is **reversed** — the narrow grant was the bug. The task/prompt text's own
safety still comes from the single-quoted heredoc, not the tool matcher, so widening the grant
adds no real exposure (same shape as the pipeline skills `build-task`/`feature-development`,
which already declare bare `Bash`).

**`--model`/`--effort`/`--permission-mode` on the dispatched session** (added post-ship, same
PR, per user request): `$prompt` may optionally start with `--model=<model>` and/or
`--effort=<effort>` (any order) — the skill parses and strips these itself before dispatch
(there's no `arguments:` frontmatter mechanism for optional flags mixed into a single
free-text arg; `arguments: prompt` still binds the whole raw input to `$prompt`), defaulting
to `sonnet`/`xhigh` when either is omitted. **Both are validated against `^[A-Za-z0-9._-]+$`
before being substituted into the command** (CodeRabbit finding, PR #156: unlike the prompt,
which is protected by the heredoc, `--model`/`--effort` were being interpolated as bare
double-quoted shell arguments — a value containing `$()`, backticks, or an embedded quote
would have executed as shell, not been treated as inert text) — a value failing that check is
reported before ever reaching the command line, not left to surface as a `claude` launch
failure. `--permission-mode auto` is **always** set explicitly,
unconditionally — not left to whatever the CLI's own default happens to be for a `--bg`
session, since the dispatched session has nobody present to answer an interactive approval
prompt. Verified live (dispatch, check result, cleanup) with the default `sonnet`/`xhigh`
pair.
