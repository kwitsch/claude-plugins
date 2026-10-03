# CLAUDE.md — coding-toolbox skill: fresh-branch

## Skill design (`fresh-branch`)

- One synchronous bash script (`fresh-branch.sh` + `fresh-branch.reference.md`, per `.claude/rules/script-authoring.md`): no MCP server, no subagent.
- Worktree state is self-detected by comparing `git rev-parse --git-dir` with `--git-common-dir`.
- Auto-stash (`git stash push -u`) and pop unconditionally on both paths, including the zero-argument refresh path that creates no branch.
- A pop conflict exits `8` and is reported; a stash is never silently dropped.
- The non-worktree branch-name collision check runs _before_ any stash or checkout, so that path never has to unwind a stash from the wrong branch.
- The full worktree × arg-count truth table lives in `SKILL.md`'s parameter table.
