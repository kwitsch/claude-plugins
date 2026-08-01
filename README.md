# claude-plugins

A [Claude Code](https://docs.claude.com/en/docs/claude-code/plugins) plugin marketplace.

## Install

```
/plugin marketplace add kwitsch/claude-plugins
```

## Plugins

| Plugin                                                           | Description                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [no-co-authored](plugins/no-co-authored/README.md)               | Blocks git commits carrying a Co-Authored-By trailer or the Claude Code footer, asking Claude to recreate the message without them.                                                                                                                                                           |
| [git-sign-key](plugins/git-sign-key/README.md)                   | Signs git commits with a `~/.claude/sign.key` file via SSH signing instead of the ssh-agent.                                                                                                                                                                                                  |
| [claude-code-knowledge](plugins/claude-code-knowledge/README.md) | Lookup skill and curated reference files for authoring and configuring Claude Code, a read-only expert agent that replaces the built-in claude-code-guide, and skills to review (cc-review), author (cc-author), audit memory (cc-memory), and compress (cc-compress) Claude Code components. |
| [coding-toolbox](plugins/coding-toolbox/README.md)               | Enforces the Interaction axis and blocks non-UTF-8 file edits automatically, plus fresh-branch, fresh-pr, finish-pr, fresh-work, feature-development, debugging, bump-version and user-level rules-setup skills for a self-contained git/PR workflow.                                         |
| [universal-format](plugins/universal-format/README.md)           | Auto-formats just-written Shell/Java/Kotlin/JS-TS/Python/Go/JSON/YAML/Markdown/CSS/SCSS/PHP files after Write/Edit using each language's standard formatter, honoring `.editorconfig` and tool-native configs.                                                                                    |
| [universal-lint](plugins/universal-lint/README.md)               | Runs each language's standard linter (read-only) on just-written Shell/Java/Kotlin/JS-TS/Python/Go/YAML/Markdown/CSS/SCSS files after Write/Edit, surfacing findings for Claude to fix; TypeScript files also get a whole-project `tsc --noEmit` type-check.                                  |
| [memory-enhancement](plugins/memory-enhancement/README.md)       | A dream skill that consolidates this project's auto-memory files in four phases, a self-improvement skill that reflects on session efficiency, and a Stop/SessionStart hook pair that nudges the next session to run a dream cycle.                                                           |
| [npm-automations](plugins/npm-automations/README.md)             | Runs an async npm ci when a package-lock.json project is entered via EnterWorktree, and an async, dependency-scoped npm install whenever a package.json's dependencies actually change.                                                                                                       |

## Configure plugins

Plugins with configuration options can be configured via
`/plugin -> installed -> select plugin -> Configure options`.
