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
| [coding-toolbox](plugins/coding-toolbox/README.md) | Mechanically enforces the Interaction axis on Stop, blocks content operations on non-UTF-8 files with an encoding hint, and provides fresh-branch, fresh-pr, fresh-work, feature-development, debugging, refactoring, bump-version, setup-rules and refresh-tools-rule skills — setup-rules installs the compressed "golden behavior rules" doc (Interaction/Language/Behavior/Mentality) and a tool-routing table as opt-in user-level rules (every project on this machine), and refresh-tools-rule is its narrow, model-invocable, non-destructive companion for refreshing an already-installed tool-routing rule — for self-contained git branch, PR/MR, end-to-end work pipeline, semver version-bump and user-level rules setup management. |
| [universal-format](plugins/universal-format/README.md) | Silently auto-formats just-written Shell/Java/Kotlin/JS-TS/Python/Go/JSON/YAML/Markdown files after Write/Edit via each language's standard formatter (prettier/biome also fall back to `npx`; no-op when no formatter is available), honoring `.editorconfig` and tool-native configs. |
| [universal-lint](plugins/universal-lint/README.md) | Silently runs each language's standard linter (read-only — never autofixes) on just-written Shell, Java, Kotlin, JS/TS, Python, Go, YAML and Markdown files after Write/Edit, surfacing any findings as additional context for Claude to fix (shellcheck, checkstyle, ktlint, eslint, ruff check, golangci-lint/go vet, yamllint, markdownlint-cli2/markdownlint; eslint/markdownlint also fall back to `npx`; runs through `rtk` for more compact output when present); JSON intentionally not covered (see plugin README). |
| [memory-enhancement](plugins/memory-enhancement/README.md) | A dream skill that runs a natural-language-triggered, four-phase memory-consolidation cycle over this project's auto-memory files (orient, gather signal from recent session transcripts, consolidate merging duplicates/dropping stale entries/resolving contradictions/authoring a new file for any signal with no existing memory home, update the MEMORY.md index under its 200-line load cutoff), optionally compressing touched detail files caveman-style via claude-code-knowledge's cc-compress when that plugin is enabled; a Stop/SessionStart hook pair flags and nudges the next session to run one, gated by the auto_dream toggle (default true); also opportunistically refreshes coding-toolbox's tool-routing rule when that plugin is installed and the rule already exists; a self-improvement skill reflects on a session's own tool calls/reasoning to find concrete efficiency lessons and saves durable, deduped findings as feedback memory. |

## Configure plugins

Plugins with configuration options can be configured via
`/plugin -> installed -> select plugin -> Configure options`.
