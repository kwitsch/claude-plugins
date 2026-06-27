# init

Idempotent repo-initialization skills for Claude Code projects.

## Install

```
/plugin install init@kwitsch-plugins
```

## Skills

| Skill | Purpose |
|---|---|
| `repo-init` | Orchestrator — runs all three init skills in sequence |
| `claude-repo-init` | Creates `CLAUDE.md` (via cc-author) and `.claude/.gitignore` |
| `codebase-repo-init` | Creates `.codebase-memory/.gitignore` and indexes the repo |
| `lsp-repo-init` | Creates `.lsp.json` from detected file extensions |

## Usage

Run all checks at once:
```
/init:repo-init
```

Or invoke individual skills:
```
/init:claude-repo-init
/init:codebase-repo-init
/init:lsp-repo-init
```

All skills are idempotent — safe to re-run.

## Dependencies

- `claude-code-knowledge` (kwitsch marketplace) — used by `claude-repo-init` to create `CLAUDE.md` via `cc-author`
- `codebase-memory-mcp` MCP server (optional) — required by `codebase-repo-init`; skips gracefully if not connected
