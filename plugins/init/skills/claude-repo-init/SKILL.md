---
name: claude-repo-init
description: Ensures a project has CLAUDE.md and .claude/.gitignore. Creates CLAUDE.md via cc-author (component_type:memory) if missing; creates/patches .claude/.gitignore to include *.lock and *.local.* entries. Idempotent.
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# claude-repo-init

Ensure the project has a documented `CLAUDE.md` and a populated `.claude/.gitignore`.
Both checks are idempotent — re-running on an already-initialized repo changes nothing.

## Preconditions (dynamic-context injection)

```!
[ -f CLAUDE.md ] && echo "CLAUDE_MD_EXISTS=yes" || echo "CLAUDE_MD_EXISTS=no"
[ -f .claude/.gitignore ] && echo "CLAUDE_GITIGNORE_EXISTS=yes" || echo "CLAUDE_GITIGNORE_EXISTS=no"
```

## Steps

### 1. CLAUDE.md

If `CLAUDE_MD_EXISTS=no`:
- Invoke `claude-code-knowledge:cc-author` with arguments `"memory CLAUDE.md"`.
  This resolves `component_type: memory`, `target_path: CLAUDE.md`, and `intent`
  from the arguments string, then dispatches the cc-author-planner and writes the
  file. (`cc-memory` is an audit/improve skill that requires an existing file;
  `cc-author` is the correct creator — it accepts free-text `$ARGUMENTS`, not
  named keyword parameters.)
- If `cc-author` is unavailable (the `claude-code-knowledge` dependency is not
  installed), skip CLAUDE.md creation and report: "cc-author unavailable —
  create CLAUDE.md manually or install the claude-code-knowledge plugin".
- Report: "CLAUDE.md created".

If `CLAUDE_MD_EXISTS=yes`:
- Report: "CLAUDE.md already present — skipping".

### 2. `.claude/.gitignore`

Required patterns: `*.lock` and `*.local.*`.

If `CLAUDE_GITIGNORE_EXISTS=no`:
- Run `mkdir -p .claude`.
- Write `.claude/.gitignore`:
  ```
  # Claude Code lock files
  *.lock

  # Personal local overrides (settings.local.json, *.local.md, …)
  *.local.*
  ```
- Report: ".claude/.gitignore created with *.lock and *.local.*".

If `CLAUDE_GITIGNORE_EXISTS=yes`:
- Read `.claude/.gitignore`.
- For each of `*.lock` and `*.local.*`: if the pattern is absent, append it.
- Report what was appended, or "already complete" if nothing changed.
