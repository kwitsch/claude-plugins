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
| [universal-format](plugins/universal-format/README.md)           | Formats prettier languages (JS/TS/JSON/YAML/Markdown/CSS/SCSS) in-process before the write with the prettier bundled into the plugin, and Shell/Java/Kotlin/Python/Go/PHP after it, honoring `.editorconfig`, `.prettierignore`/`.gitignore` and tool-native configs.                         |
| [universal-lint](plugins/universal-lint/README.md)               | Runs each language's standard linter (read-only) on just-written Shell/Java/Kotlin/JS-TS/Python/Go/YAML/Markdown/CSS/SCSS/PHP files after Write/Edit, surfacing findings for Claude to fix; TypeScript files also get a whole-project `tsc --noEmit` type-check.                              |
| [memory-enhancement](plugins/memory-enhancement/README.md)       | A dream skill that consolidates this project's auto-memory files in four phases, a self-improvement skill that reflects on session efficiency, and a Stop/SessionStart hook pair that nudges the next session to run a dream cycle.                                                           |
| [npm-automations](plugins/npm-automations/README.md)             | Runs an async lockfile-frozen install (npm/pnpm/yarn, picked by whichever lockfile is present) when a project is entered via EnterWorktree, and an async, dependency-scoped install whenever a package.json's dependencies actually change.                                                   |
| [kiwi-code-style](plugins/kiwi-code-style/README.md)             | Ships the kiwi-code-style output style and a SessionStart hook that injects the karpathy-ponytail coding guidelines — both enforced whenever this plugin is enabled.                                                                                                                          |
| [taskflow](plugins/taskflow/README.md)                           | Spec-driven design & delivery pipeline: `/taskflow:build-task` orchestrates a design-to-spec workflow and a spec-driven-delivery workflow (wave-parallel implement in isolated worktrees, combined review, fix application, ship).                                                            |

## Configure plugins

Plugins with configuration options can be configured via
`/plugin -> installed -> select plugin -> Configure options`.
