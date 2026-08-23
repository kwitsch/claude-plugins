---
paths:
  - "plugins/*/skills/*/SKILL.md"
---

# Rule: SKILL.md authoring reference

Source: <https://code.claude.com/docs/en/skills>

## Frontmatter (complete reference)

```yaml
---
name:
  my-skill # display name in listings; defaults to directory name
  # NOTE: in plugin skills/ subdirs the DIRECTORY name sets
  # the command (/plugin:dir-name), not this field.
  # `name` only overrides the command for a plugin-root SKILL.md.
description:
  What it does and when # RECOMMENDED — Claude uses this to decide when to apply.
  # Omit → first markdown paragraph used. Put key use case
  # first; combined with when_to_use, truncated at 1,536 chars.
when_to_use: | # Extra trigger context / example phrases for Claude.
  Appended to description in listings; counts toward 1,536-char cap.
argument-hint: "[issue-number]" # Shown in autocomplete; e.g. "[filename] [format]"
arguments: file format # Named positional args → $file $format ($0 $1 shorthand)
disable-model-invocation:
  true # true = only user can invoke (/name). Use for side-effect
  # workflows (deploy, commit, send-message). Also blocks
  # skill from being preloaded into subagents.
user-invocable: false # false = only Claude can invoke (background knowledge skills)
context:
  fork # Run skill in isolated subagent (no conversation history).
  # Only useful for skills with explicit task instructions.
model: claude-haiku-4-5-20251001 # Model while this skill is active (rest of current turn; not saved). /model values or `inherit`.
effort: low # Effort while active: low/medium/high/xhigh/max; overrides session effort.
allowed-tools:
  Bash(git *) Read # Pre-approve tools — no permission prompt while skill active.
  # Does NOT restrict other tools; permission settings still apply.
  # Takes effect only after workspace trust dialog accepted.
disallowed-tools: Write # Remove tools from pool while skill active (clears next turn).
---
```

## Supporting files

Place additional files alongside `SKILL.md` in the same skill directory:

```
my-skill/
├── SKILL.md           # main instructions (required)
├── template.md        # template for Claude to fill in
├── examples/
│   └── sample.md      # expected output format
└── scripts/
    └── validate.sh    # script Claude can execute
```

Reference them from `SKILL.md` body: `See [template.md](template.md)`. Keep `SKILL.md` under **500 lines** — move reference material to supporting files.

## Inject dynamic context

`` !`<command>` `` runs a shell command at load time; output replaces the placeholder **before** the skill is sent to Claude. Claude only sees the result, not the command.

```markdown
Current branch: !`git branch --show-current`
Open issues: !`gh issue list --limit 5`
```

Multi-line variant (fenced block):

````markdown
## Environment

```!
node --version
git status --short
```
````

Rules:

- `!` must appear at line start or after whitespace — `` KEY=!`cmd` `` is NOT expanded.
- The preprocessor does NOT respect markdown code spans: an
  exclamation-then-backtick sequence inside `` `…` `` / doubled-backtick
  spans still executes at load time. Never write that literal two-character
  sequence anywhere in a SKILL.md body — not even as a quoted example or
  cautionary mention (confirmed 2026-08-23: taskflow `build-task`'s own
  warning paragraph quoting the anti-pattern re-broke every
  worktree-isolated dispatch). Describe the pattern in words instead.
- Output is plain text; no second-pass expansion of further `` !`...` `` placeholders.
- Disable repo-wide with `"disableSkillShellExecution": true` in settings.
- For `$CLAUDE_PLUGIN_ROOT`/`$CLAUDE_SKILL_DIR` specifically, prefer the bare
  `${...}` pre-injection substitution form over `!`-injecting them — see
  `.claude/rules/script-authoring.md`'s "Invocation mechanism" section for
  why (this repo has a confirmed, deterministic failure mode from the
  `!`-injected form when the invoking session is worktree-isolated).

## Invocation control

| Frontmatter                      | User invoke | Claude auto-invoke |
| -------------------------------- | ----------- | ------------------ |
| _(none)_                         | ✓           | ✓                  |
| `disable-model-invocation: true` | ✓           | ✗                  |
| `user-invocable: false`          | ✗           | ✓                  |

## Best practices

- **description first**: put the key use case at the start — listing truncates at 1,536 chars.
- **Token cost**: skill content stays in context across all turns once loaded → every line recurs. Keep body concise; state what to do, not how or why.
- **context: fork** only for skills with explicit task instructions; guidelines without a task produce no meaningful output from the subagent.
- **allowed-tools**: scope tightly — broad grants apply as long as the skill is active.
- **Subagents inherit no history**: pass all required context explicitly in the skill body or via `$ARGUMENTS`.
- **Plugin command naming**: command is `/<plugin-name>:<skill-dir-name>`. `name` frontmatter is ignored for command resolution in `skills/` subdirectories; only used in skill listings.
