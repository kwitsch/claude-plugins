# CLAUDE.md — coding-toolbox skill: fresh-branch

## Skill design (`fresh-branch`)

The bash logic lives in a standalone `fresh-branch.sh` + colocated
`fresh-branch.reference.md`, per `.claude/rules/script-authoring.md`'s
convention for substantial skill scripts.

Single synchronous bash script (no MCP server, no subagent),
self-detecting worktree state via `git rev-parse --git-dir` vs
`--git-common-dir`. Auto-stashes (`git stash push -u`) and pops
unconditionally around both paths, including the refresh-only path (zero-argument invocations) that creates no new branch —
never silently drops a stash on a pop conflict (exit `8`, reported). The
non-worktree branch-name collision check runs _before_ any stash or checkout so
that path never has to unwind a stash from the wrong branch. See `plugins/coding-toolbox/skills/fresh-branch/SKILL.md`'s parameter table for the full worktree × arg-count truth table.
