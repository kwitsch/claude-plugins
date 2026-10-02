---
paths:
  - "plugins/*/README.md"
---

# Rule: plugin README structure and sync

## Install section (must be first)

Every `plugins/*/README.md` must have `## Install` as its **first section** (immediately after the title), containing a fenced code block with the install command for that plugin.

**Required format** (replace `<plugin-name>` with the plugin's directory name):

````markdown
## Install

```
/plugin install <plugin-name>@kwitsch-plugins
```
````

**Model:** root `README.md` `## Install` section.

## Component sections

Every `plugins/*/README.md` must list its components in dedicated tabular sections,
per the templates below.

**Hooks must NOT appear as a dedicated section.** Hook behavior is described via the Skills table, Configuration options table, or the plugin's general description — never as a standalone `## Hooks` section.

### Skills (if any skills exist)

```markdown
## Skills

| Skill    | What it does |
| -------- | ------------ |
| `<name>` | description  |
```

**If a skill named `configure-*` exists, it must be the first row** in the Skills table.

### Agents (if any agents exist)

```markdown
## Agents

| Agent    | Model             | Role        |
| -------- | ----------------- | ----------- |
| `<name>` | haiku/sonnet/opus | description |
```

A plugin may pin the Model cell to a literal model ID instead of a bare alias
only as a documented, dated exception recorded in that plugin's own
`CLAUDE.md`. Absent such a recorded exception, use the bare alias.

### Configuration (if a `configure-*` skill exists)

Include a `## Configuration` section with:

1. How to invoke the configurator (`/configure-<name>`)
2. **An options table** (if the plugin has `userConfig` entries):

```markdown
| Option  | Default     | Effect / Value              |
| ------- | ----------- | --------------------------- |
| `<key>` | `<default>` | what it does / valid values |
```

Derive option keys + defaults from the plugin's `.claude-plugin/plugin.json` `userConfig` field.

## Root README sync

When modifying any `plugins/*/README.md`, validate the corresponding row in the root `README.md` plugins table.

**Table format:**

```
| [<plugin-name>](plugins/<plugin-name>/README.md) | one-line description |
```

The row's description is derived from the plugin README and kept accurate to the plugin's current functionality.

## Before finishing a README edit, verify

- `## Install` is the first `##` heading after the title and its fenced block holds `/plugin install <plugin-name>@kwitsch-plugins`.
- The root `README.md` `## Plugins` table has a row for this plugin (link target `plugins/<name>/README.md`) whose description is still accurate — add or update it if missing or outdated.
