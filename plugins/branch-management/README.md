# branch-management

Skills for the branch lifecycle: cut a fresh work branch from the updated
default branch, and turn a finished branch into a reviewed, pushed PR/MR.

## Install

```
/plugin install branch-management@kwitsch-plugins
```

## What it does

Two skills:

- **new-branch** — switches to the default branch, pulls it (`--ff-only`),
  then creates and checks out a new work branch (`feat/...`, `fix/...`, …).
  When the context-mode plugin is installed, the repository is re-indexed
  afterwards.
- **new-pr** — runs every code review available in the session against the
  base branch (the `code-review` skill with `--fix`, the
  [copilot plugin](https://github.com/wagnersza/copilot-plugin-cc)'s
  `/copilot:review`, the
  [codex plugin](https://github.com/openai/codex-plugin-cc)'s
  `/codex:review`, the
  [coderabbit plugin](https://github.com/coderabbitai/claude-plugin)'s
  `/coderabbit:review`), fixes the findings, makes sure everything is
  committed, pushes the branch, and opens a pull request (`gh`) or merge
  request (`glab`) depending on where `origin` points.

Optional integrations are skipped silently when the corresponding plugin is
not installed.
