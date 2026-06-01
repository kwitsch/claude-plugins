# claude-plugins

A [Claude Code](https://docs.claude.com/en/docs/claude-code/plugins) plugin marketplace.

## Repository structure

- `.claude-plugin/marketplace.json` — marketplace manifest (name, owner, plugin list). Must live at the repo root.
- `plugins/<plugin-name>/` — one directory per plugin.
  - `.claude-plugin/plugin.json` — plugin manifest (name, version, description, …).
  - `commands/`, `skills/`, `agents/`, `hooks/`, … — plugin components at the plugin root.
- `.github/workflows/ci.yml` — validates the marketplace manifest and plugin sources.

## Add a plugin

1. Create `plugins/<plugin-name>/` with at least a `.claude-plugin/plugin.json` and your components.
2. Add an entry to the `plugins` array in `.claude-plugin/marketplace.json` with a `name` and a `source` (e.g. `"./plugins/<plugin-name>"`).

See the [marketplace](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces) and [plugin](https://docs.claude.com/en/docs/claude-code/plugins-reference) references for the full schema.

## Use the marketplace

```
/plugin marketplace add kwitsch/claude-plugins
/plugin install no-co-authored@claude-plugins
```
