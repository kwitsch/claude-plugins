# Claude Code skill folder structure

<!-- static convention reference — NOT refreshed by /update-cc-references -->

Directory layout of a Claude Code skill, plus this plugin's convention for where
reference files live. Mechanics of *what a skill is* and its frontmatter live in
`claude-code-skills-reference.md`; this file is layout-only.

## Skill directory layout

A skill is a directory whose name sets the command (`/<plugin>:<dir-name>` for
plugin skills). It MUST contain `SKILL.md`; everything else is optional supporting
material loaded on demand from the skill body.

```
<skill-name>/
  SKILL.md            # required — frontmatter + instructions (the only file always loaded)
  <supporting files>  # templates, examples, scripts, reference docs — loaded only when SKILL.md points to them
  scripts/            # optional — executable helpers the skill runs
  references/         # optional — bundled reference/knowledge files (see convention below)
```

- Only `SKILL.md` is read into context at skill load. Supporting files are read
  lazily when the body references them (keeps the always-on budget small).
- Reference supporting files from the body with `${CLAUDE_SKILL_DIR}/<path>` so
  they resolve at plugin, project, and personal scope.

## Convention: one supporting file vs many → `references/`

This plugin's layout rule for a skill's bundled reference/knowledge files:

| Count | Location | Path from `SKILL.md` |
|---|---|---|
| **1** reference file | next to `SKILL.md` (skill root) | `${CLAUDE_SKILL_DIR}/<file>.md` |
| **≥2** reference files | in a `references/` subfolder | `${CLAUDE_SKILL_DIR}/references/<file>.md` |

- When a skill grows from one bundled reference file to two or more, move them all
  into `references/` and update the `${CLAUDE_SKILL_DIR}/...` paths in `SKILL.md`.
- `SKILL.md` itself never moves — it stays at the skill root.
- `scripts/` (executables) is a separate concern and is not affected by this rule.

## Example (this skill)

`cc-reference` ships many reference files, so they live under `references/`:

```
cc-reference/
  SKILL.md
  references/
    claude-code-skills-reference.md
    claude-code-agents-reference.md
    claude-code-hooks-reference.md
    hook-handler-selection.md
    claude-code-commands-reference.md
    claude-code-mcp-reference.md
    claude-code-plugins-reference.md
    claude-code-memory-reference.md
    claude-code-settings-reference.md
    skill-folder-structure.md
```
