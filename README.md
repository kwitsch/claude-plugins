# claude-plugins

A [Claude Code](https://docs.claude.com/en/docs/claude-code/plugins) plugin marketplace.

## Install

```
/plugin marketplace add kwitsch/claude-plugins
```

## Plugins

| Plugin | Description |
|--------|-------------|
| [no-co-authored](plugins/no-co-authored/README.md) | Blocks git commits carrying a Co-Authored-By trailer or the Claude Code footer, asking Claude to recreate the message without them. |
| [git-sign-key](plugins/git-sign-key/README.md) | Signs git commits with a `~/.claude/sign.key` file via SSH signing instead of the ssh-agent. |
| [branch-management](plugins/branch-management/README.md) | Skills that cut a fresh work branch from the updated default branch and turn a finished branch into a reviewed, pushed PR/MR. |
| [superpowers-automation](plugins/superpowers-automation/README.md) | A new-work pipeline orchestrator that classifies a description as feature/fix/refactor and runs the matching flow (feature/refactor: branch -> brainstorm -> review -> plan -> review -> implement; fix: systematic-debugging), plus the file-advisor-improver reviser and an opt-in plan hook forcing Subagent-Driven implementation. |
| [claude-code-knowledge](plugins/claude-code-knowledge/README.md) | Lookup skill plus harness-optimized reference files for authoring & configuring Claude Code (skills, subagents, hooks, commands, MCP, plugins, memory, settings), a read-only expert agent that replaces the built-in claude-code-guide, a cc-review skill that audits components and applies fixes, a cc-author skill that creates new components, a cc-memory skill that audits & improves CLAUDE.md, and a cc-compress skill that compresses a markdown memory file into caveman-style prose to cut future load tokens — all grounded in the same cc-reference knowledge. |
| [coding-toolbox](plugins/coding-toolbox/README.md) | Injects a compressed "golden behavior rules" doc (Interaction/Language/Behavior/Mentality) at session start, re-injects a short reminder before consequential tool calls, blocks content operations on non-UTF-8 files with an encoding hint, and provides fresh-branch, fresh-pr and fresh-work skills for self-contained git branch, PR/MR and end-to-end work pipeline management. |

## Configure plugins

Plugins with configuration options can be configured via
`/plugin -> installed -> select plugin -> Configure options`.
