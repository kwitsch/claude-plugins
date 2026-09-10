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

**After any Write or Edit to `plugins/*/README.md`:**

1. Check that `## Install` is the first `##`-level heading after the title line
2. Check that the section contains a fenced code block with `/plugin install <plugin-name>@kwitsch-plugins`
3. If missing or wrong → add or fix before finishing the edit

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
`CLAUDE.md` (e.g. taskflow's Opus-tier pin to `claude-opus-4-8` — see
`plugins/taskflow/CLAUDE.md`'s "Model assignment" section). Absent such a
recorded exception, use the bare alias.

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

**After any Write or Edit to `plugins/*/README.md`:**

1. Read root `README.md` and locate the `## Plugins` table
2. Find the row for this plugin (link target `plugins/<name>/README.md`)
3. If row **missing** → add it with an accurate description derived from the plugin README
4. If description **outdated or inaccurate** → update it to match the plugin's current functionality
5. If row **correct** → no action needed
