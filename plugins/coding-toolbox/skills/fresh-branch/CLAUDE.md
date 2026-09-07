# CLAUDE.md — coding-toolbox skill: fresh-branch

## Skill design (`fresh-branch`)

2026-07-25: the embedded script extracted to a standalone
`fresh-branch.sh` + colocated `fresh-branch.reference.md` per
`.claude/rules/script-authoring.md`'s updated convention.

Single synchronous bash script (now a standalone file, no MCP server, no
subagent), self-detecting worktree state via `git
rev-parse --git-dir` vs `--git-common-dir`. Supports a custom base/upstream
and a branch+base pair. Auto-stashes (`git stash push -u`) and pops
unconditionally around both paths, including the refresh-only path (now
universal for zero-argument invocations, not just inside a worktree —
2026-07-02, extended same day per user request) that creates no new branch —
never silently drops a stash on a pop conflict (exit `8`, reported). The
non-worktree branch-name collision check runs _before_ any stash or checkout so
that path never has to unwind a stash from the wrong branch. See `skills/fresh-branch/SKILL.md`'s parameter table for the full worktree × arg-count truth table.
