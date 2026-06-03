# claude-plugins

A [Claude Code](https://docs.claude.com/en/docs/claude-code/plugins) plugin marketplace.

## Add a plugin

1. Create `plugins/<plugin-name>/` with at least a `.claude-plugin/plugin.json` and your components.
2. Add an entry to the `plugins` array in `.claude-plugin/marketplace.json` with a `name` and a `source` (e.g. `"./plugins/<plugin-name>"`).

See the [marketplace](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces) and [plugin](https://docs.claude.com/en/docs/claude-code/plugins-reference) references for the full schema.

## Plugins

| Plugin | Description |
|--------|-------------|
| [no-co-authored](plugins/no-co-authored/README.md) | Strips Co-Authored-By trailers and the Claude Code footer from git commit messages. |
| [git-sign-key](plugins/git-sign-key/README.md) | Signs git commits with a `~/.claude/sign.key` file via SSH signing instead of the ssh-agent. |
| [cctools-edit](plugins/cctools-edit/README.md) | Installs the cc-tools binary for the host OS and routes Read/Write/Edit/MultiEdit through it to preserve file encodings. |

## Use the marketplace

```
/plugin marketplace add kwitsch/claude-plugins
/plugin install no-co-authored@kwitsch-plugins
```
