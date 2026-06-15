# Claude Code Memory — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (How Claude remembers your project), verified 2026-06-14.
> Apply when authoring or editing CLAUDE.md files or configuring auto memory.

## CLAUDE.md: what & when

- CLAUDE.md = plain-text markdown file loaded into every session's context window at startup.
- Use it to give Claude persistent instructions it would otherwise need re-explaining.
- Add to it when: Claude repeats the same mistake, a convention must hold every session, or a setup step isn't discoverable from the codebase alone.
- Do NOT use it as a scratchpad or project log; keep it to directives Claude must hold every session.
- Run `/init` to generate a starting CLAUDE.md automatically; Claude analyzes the codebase and creates build commands, test instructions, and project conventions it discovers.
- Target **under 200 lines** per CLAUDE.md file — longer files consume more context and reduce adherence.
- CLAUDE.md instructions are context, not enforced configuration. To block an action regardless of Claude's decision, use a `PreToolUse` hook instead.

### Write effective instructions

- **Specificity**: concrete and verifiable: `"Use 2-space indentation"` not `"Format code properly"`.
- **Structure**: markdown headers and bullets; organized sections are easier to follow than dense paragraphs.
- **Consistency**: two contradictory rules → Claude may pick one arbitrarily; review periodically.
- In monorepos, use `claudeMdExcludes` to skip CLAUDE.md files from other teams.

## Locations & precedence

Files load in the order below (broadest to most specific); a later entry wins on conflict.

| Scope | Location | Shared with |
|---|---|---|
| **Managed policy** | Linux/WSL: `/etc/claude-code/CLAUDE.md`; macOS: `/Library/Application Support/ClaudeCode/CLAUDE.md`; Windows: `C:\Program Files\ClaudeCode\CLAUDE.md` | All users on machine |
| **User** | `~/.claude/CLAUDE.md` | Just you (all projects) |
| **Project** | `./CLAUDE.md` or `./.claude/CLAUDE.md` | Team (via source control) |
| **Local project** | `./CLAUDE.local.md` (add to `.gitignore`) | Just you (current project) |

- CLAUDE.md and CLAUDE.local.md files **in the directory hierarchy above the working directory** load in full at launch.
- Files **in subdirectories** load on demand when Claude reads files in those directories.
- Managed policy CLAUDE.md **cannot be excluded** by `claudeMdExcludes` — always loads.
- `claudeMd` key in `managed-settings.json` injects CLAUDE.md content directly; honored only in managed/policy scope.
- `claudeMdExcludes` in `.claude/settings.local.json` skips files by path or glob (matched against absolute paths); arrays merge across settings layers.

### User-level rules

- `~/.claude/rules/` applies to every project on the machine.
- Loaded before project rules → project rules take higher priority.

## Imports (@path syntax, recursion depth, home-dir imports)

- Syntax: `@path/to/file` anywhere in a CLAUDE.md file.
- Both relative and absolute paths are allowed.
- Relative paths resolve relative to the **importing file**, not the working directory.
- Imported files are expanded and loaded into context at launch (not on demand).
- Recursive imports are allowed; **maximum depth: 4 hops**.
- To share personal instructions across git worktrees, import from home directory:

```text
# Individual Preferences
- @~/.claude/my-project-instructions.md
```

- First encounter of external imports: Claude shows an approval dialog listing the files; declining disables imports (dialog does not reappear).
- Imported files still load at launch and consume context window tokens.

## Auto memory

- Auto memory = notes Claude writes itself, based on corrections, preferences, and patterns it discovers.
- Claude decides what to save; it does not write something every session.
- Machine-local; not shared across machines or cloud environments.
- All worktrees and subdirectories in the same git repo share one auto memory directory.
- version >= 2.1.59: feature requires at least this Claude Code version (`claude --version`).

### Storage location

Default path: `~/.claude/projects/<project>/memory/` where `<project>` is derived from the git repository root. Outside a git repo, the project root is used.

```text
~/.claude/projects/<project>/memory/
├── MEMORY.md          # concise index; loaded into every session
├── debugging.md       # detailed notes on debugging patterns
├── api-conventions.md # API design decisions
└── ...                # any other topic files Claude creates
```

- `MEMORY.md` is the entry point; first **200 lines or 25 KB** (whichever comes first) load at session start.
- Topic files (e.g., `debugging.md`) are **not** loaded at startup; Claude reads them on demand.
- Override storage path with `autoMemoryDirectory` in settings:

```json
{
  "autoMemoryDirectory": "~/my-custom-memory-dir"
}
```

Value must be an absolute path or start with `~/`. When set in a project's `.claude/settings.json` or `.claude/settings.local.json`, honored only after workspace trust dialog is accepted.

### Enable / disable

- On by default.
- Toggle via `/memory` → auto memory toggle in session.
- Or set in settings:

```json
{
  "autoMemoryEnabled": false
}
```

- Environment variable: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

## What belongs / what doesn't

| Belongs in CLAUDE.md | Keep out of CLAUDE.md |
|---|---|
| Build/test/lint commands | Multi-step procedures (use a skill instead) |
| Coding conventions and style rules | Derivable facts (directory structure Claude can discover) |
| Project architecture overview | Information only relevant to one subdirectory (use `.claude/rules/` with `paths:`) |
| "Always do X" / "Never do Y" rules | Technical enforcement (use `permissions.deny` in managed settings) |
| Compliance/security reminders | Frequently changing runtime data |

- Move a CLAUDE.md section to a skill when it becomes a multi-step procedure.
- Move it to a path-scoped rule when it only applies to specific file types.
- Use managed settings (`permissions.deny`, `sandbox.enabled`) for hard enforcement; CLAUDE.md is guidance, not enforcement.

### `.claude/rules/` for path-scoped rules

- Place rule files in `.claude/rules/` directory.
- Rules without a `paths` frontmatter field load unconditionally for all files.
- Rules with `paths` load only when Claude works with matching files:

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Development Rules
- All API endpoints must include input validation
```

- User-level rules: `~/.claude/rules/` — apply to every project on the machine.
- Share across projects with symlinks.

## Quick add & editing

| Action | How |
|---|---|
| Open memory viewer | `/memory` — lists all CLAUDE.md, CLAUDE.local.md, and rules files in current session |
| Toggle auto memory | `/memory` → auto memory toggle |
| Open auto memory folder | `/memory` → link to open folder |
| Edit any loaded file | `/memory` → select file to open in editor |
| Ask Claude to remember something | Tell Claude directly: `"always use pnpm, not npm"` → saved to auto memory |
| Add to CLAUDE.md instead | Tell Claude: `"add this to CLAUDE.md"`, or edit via `/memory` |
| Audit/delete memory | Auto memory files are plain markdown; edit or delete at any time |

- When you see "Writing memory" or "Recalled memory" in the interface, Claude is actively updating or reading `~/.claude/projects/<project>/memory/`.

## Version notes

| version >= X.Y | Note |
|---|---|
| version >= 2.1.59 | Auto memory feature available; verify with `claude --version` |
