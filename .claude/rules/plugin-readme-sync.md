---
paths:
  - "plugins/*/README.md"
---

# Rule: plugin README structure

## Section structure

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

See `.claude/rules/plugin-readme-root-sync.md` for the separate root-README-sync procedure (same trigger, different rule file).
