# CLAUDE.md — coding-toolbox skill: dispatch-agent

Behavior lives in `SKILL.md`; this file holds the standing rules and why they exist.

## Skill design (`dispatch-agent`)

- Single-step skill, no extracted script: it dispatches a real, independent, worktree-isolated background session (`claude --worktree <name> --bg`, managed via `claude agents`/`logs`/`attach`/`stop`/`rm`).
- Never swap in the in-session `Agent` tool: that spawns a subagent of the current conversation, not a separate session — rejected on purpose.

### Base branch and `worktree.baseRef`

- Do not re-add a pre-dispatch "sync the current branch" step (`git fetch origin` + `git merge --ff-only @{u}`).
  - It never fed the dispatch: `claude --worktree` owns the base. Its only effect was freshening this session's own branch; a plain `fresh-branch` covers that when wanted.
  - Nothing in the skill calls `git`, so `allowed-tools` has no `Bash(git:*)`.
- Never hand-roll `git worktree add` to "fix the wrong base branch": adopting the native flag, and with it an `origin/<default-branch>` base instead of the current branch, is a recorded decision reversal.
  - The native flag places worktrees as siblings under the primary checkout (no nesting, even from inside another worktree).
  - The CLI tracks them in its own job state, so `claude rm <id>` removes the worktree too (a hand-created one needed a separate `git worktree remove`).
- Document `worktree.baseRef`, never override it.
  - Default `"fresh"` branches off the default branch on `origin`; `"head"` branches every new worktree from local `HEAD`, carrying unpushed commits and feature-branch state.
  - SKILL.md and this file must state that conditional, never an unconditional default-branch base (pinned in `test/coding-toolbox/dispatch-agent.bats`).

### Prompt and name handling

- Embed the prompt in a quoted heredoc read back via direct command substitution, with no intermediate temp file: under `set -e` a failing dispatch skips the cleanup `rm -f` and leaks the prompt to disk.
  - Removing the file beat adding a `trap`.
  - The quoted delimiter protects the **prompt only**, not other values substituted into the same command — see `--model`/`--effort` below.
- Known, unaddressed exposure: the delimiter is fixed, so a prompt line exactly equal to it ends the heredoc early and the rest runs as shell.
  - `setup-rules` avoids this class by writing untrusted text to a `mktemp` file via the `Write` tool, never a heredoc.
- Name = 3-6-word English slug of the prompt (same convention as `fresh-work`'s branch naming) + `$(date +%s)-$RANDOM`.
  - A bare timestamp resolves only to the second, so two same-second dispatches of one prompt collide; `$RANDOM` closes that without retry logic.
  - The slug makes sessions distinguishable without attaching to read each prompt.
- Regex-guard `$name` against `^[A-Za-z0-9._-]+$` before the length check, mirroring `dispatch-task`'s worktree-name validation.

### `allowed-tools`

- Keep bare `Bash` (plus `AskUserQuestion`); no `Agent`, no `Skill`. Never narrow back to `Bash(claude:*)`.
  - Step 1's call is a compound script (`set -e`, a `name="…-$(date +%s)-$RANDOM"` assignment whose command substitution is not a known-safe leading assignment, then `claude … --bg`).
  - The permission matcher splits on separators and requires every sub-command to be covered independently (cc-reference settings reference, "Per-tool specifiers"), so `Bash(claude:*)` never auto-approved it and the dispatch stalled with nobody present to answer.
- Widening adds no real exposure: prompt safety comes from the single-quoted heredoc, not the tool matcher (same shape as `build-task`/`feature-development`, which declare bare `Bash`).

### `--model` / `--effort` / `--permission-mode`

- The skill parses and strips optional leading `--model=`/`--effort=` itself: `arguments: prompt` binds the whole raw input, and frontmatter has no mechanism for optional flags mixed into one free-text arg.
- Validate both against `^[A-Za-z0-9._-]+$` before substitution.
  - Unlike the prompt, they are interpolated as bare double-quoted shell arguments; `$()`, backticks or an embedded quote would execute as shell.
  - A failing value is reported before it reaches the command line — never sanitized, never left to surface as a `claude` launch failure.
- Always pass `--permission-mode auto` explicitly, never rely on the CLI's `--bg` default: the dispatched session has nobody present to answer an interactive approval prompt.
