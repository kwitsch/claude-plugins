---
paths:
  - "plugins/*/README.md"
---

# Rule: plugin README structure + root README sync

## Section structure

Every `plugins/*/README.md` must list its components in dedicated tabular sections.
Model: `plugins/branch-management/README.md`.

### Skills (if any skills exist)

```markdown
## Skills

| Skill | What it does |
|---|---|
| `<name>` | description |
```

**If a skill named `configure-*` exists, it must be the first row** in the Skills table.

### Agents (if any agents exist)

```markdown
## Agents

| Agent | Model | Role |
|---|---|---|
| `<name>` | haiku/sonnet/opus | description |
```

### Configuration (if a `configure-*` skill exists)

Include a `## Configuration` section with:
1. How to invoke the configurator (`/configure-<name>`)
2. **An options table** (if the plugin has `userConfig` entries):

```markdown
| Option | Default | Effect / Value |
|---|---|---|
| `<key>` | `<default>` | what it does / valid values |
```

Derive option keys + defaults from the plugin's `.claude-plugin/plugin.json` `userConfig` field.

---

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
