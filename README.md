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
| [cctools-edit](plugins/cctools-edit/README.md) | Installs the cc-tools binary for the host OS and routes Read/Write/Edit/MultiEdit through it to preserve file encodings. |
| [branch-management](plugins/branch-management/README.md) | Skills that cut a fresh work branch from the updated default branch and turn a finished branch into a reviewed, pushed PR/MR. |
| [superpowers-automation](plugins/superpowers-automation/README.md) | A new-feature pipeline orchestrator (branch -> brainstorm -> review -> plan -> review -> implement) plus the file-advisor-improver reviser and an opt-in plan hook forcing Subagent-Driven implementation. |
| [claude-code-knowledge](plugins/claude-code-knowledge/README.md) | Lookup skill plus harness-optimized reference files for authoring & configuring Claude Code (skills, subagents, hooks, commands, MCP, plugins, memory, settings), plus a read-only expert agent that replaces the built-in claude-code-guide. Retrieves only the relevant section into context. |

## Configure plugins

Plugins with configuration options can be configured via
`/plugin -> installed -> select plugin -> Configure options`.
