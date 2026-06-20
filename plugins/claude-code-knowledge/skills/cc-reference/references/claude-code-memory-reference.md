# Claude Code Memory — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (How Claude remembers your project), verified 2026-06-20.
> Apply when authoring or editing CLAUDE.md files or configuring auto memory.

## CLAUDE.md: what & when

- CLAUDE.md = plain-text markdown file loaded into every session's context window at startup.
- Use it to give Claude persistent instructions it would otherwise need re-explaining.
- Add to it when: Claude repeats the same mistake, a convention must hold every session, or a setup step isn't discoverable from the codebase alone.
- Do NOT use it as a scratchpad or project log; keep it to directives Claude must hold every session.
- Run `/init` to generate a starting CLAUDE.md automatically; Claude analyzes the codebase and creates build commands, test instructions, and project conventions it discovers. If a CLAUDE.md already exists, `/init` suggests improvements rather than overwriting. `/init` also reads `AGENTS.md`, `.cursorrules`, `.devin/rules/`, `.windsurfrules` and incorporates relevant parts.
- `CLAUDE_CODE_NEW_INIT=1`: enables interactive multi-phase `/init` — asks which artifacts to set up (CLAUDE.md/skills/hooks), explores via subagent, asks follow-ups, presents a reviewable proposal before writing.
- Target **under 200 lines** per CLAUDE.md file — longer files consume more context and reduce adherence.
- CLAUDE.md instructions are context, not enforced configuration. To block an action regardless of Claude's decision, use a `PreToolUse` hook instead.
- CLAUDE.md content is delivered as a **user message after the system prompt**, not part of the system prompt — no guarantee of strict compliance, especially for vague/conflicting instructions.
- For system-prompt-level instructions, use `--append-system-prompt` (must be passed every invocation; suited to scripts/automation, not interactive use).
- Block-level HTML comments (`<!-- ... -->`) in CLAUDE.md are stripped before injection into context (use them for human-maintainer notes). Comments inside code blocks are preserved; the Read tool shows all comments.

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
- Load ordering: Claude walks up the directory tree from cwd, concatenating all discovered files (not overriding). Ordered filesystem-root → cwd, so files closest to launch dir are read **last**. Within each directory, `CLAUDE.local.md` is appended **after** `CLAUDE.md`.
- Managed policy CLAUDE.md **cannot be excluded** by `claudeMdExcludes` — always loads.
- `claudeMd` key in `managed-settings.json` injects CLAUDE.md content directly; honored only in managed/policy scope.
- `claudeMdExcludes` skips files by path or glob (matched against absolute paths); configurable at **any** settings layer (user/project/local/managed); arrays merge across layers. Put it in `.claude/settings.local.json` to keep the exclusion local to your machine.
- `--add-dir` directories do NOT load their CLAUDE.md by default. Set `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` to load `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`, `CLAUDE.local.md` from them (`CLAUDE.local.md` skipped if `local` is excluded from `--setting-sources`).
- Compaction: project-root CLAUDE.md **survives `/compact`** — re-read from disk and re-injected. Nested subdirectory CLAUDE.md files are NOT re-injected automatically; they reload next time Claude reads a file in that subdirectory.

### User-level rules

- `~/.claude/rules/` applies to every project on the machine.
- Loaded before project rules → project rules take higher priority.

## Imports (@path syntax, recursion depth, home-dir imports)

- Syntax: `@path/to/file` anywhere in a CLAUDE.md file.
- Both relative and absolute paths are allowed.
- Relative paths resolve relative to the **importing file**, not the working directory.
- Imported files are expanded and loaded into context at launch (not on demand). Imports do NOT reduce context — imported files load at launch.
- Recursive imports are allowed; **maximum depth: 4 hops**.
- Import parsing **skips Markdown code spans and fenced code blocks**. Wrap a path in backticks (`` `@README` ``) to keep it literal; `@README` outside backticks imports.
- To share personal instructions across git worktrees, import from home directory:

```text
# Individual Preferences
- @~/.claude/my-project-instructions.md
```

- First encounter of external imports: Claude shows an approval dialog listing the files; declining disables imports (dialog does not reappear).
- Imported files still load at launch and consume context window tokens.

### AGENTS.md

- Claude Code reads `CLAUDE.md`, **not** `AGENTS.md`.
- To reuse an existing `AGENTS.md`: create a `CLAUDE.md` that imports it (`@AGENTS.md`) — add Claude-specific instructions below the import. Or symlink (`ln -s AGENTS.md CLAUDE.md`) if no Claude-specific content is needed.
- On Windows symlinks need Administrator/Developer Mode → use the `@AGENTS.md` import instead.

## Auto memory

- Auto memory = notes Claude writes itself, based on corrections, preferences, and patterns it discovers.
- Claude decides what to save; it does not write something every session.
- Machine-local; not shared across machines or cloud environments.
- All worktrees and subdirectories in the same git repo share one auto memory directory.
- Subagents can maintain their own auto memory (see subagent docs `/en/sub-agents#enable-persistent-memory`).
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

Value must be an absolute path or start with `~/`. Read from **any** settings scope (user/project/local/policy/`--settings`). When set in a project's `.claude/settings.json` or `.claude/settings.local.json`, honored only after the workspace trust dialog is accepted (same gate as hooks).

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

- Place rule files in `.claude/rules/` directory; one topic per file. All `.md` files are discovered **recursively** (organize into subdirs like `frontend/`, `backend/`).
- Rules without a `paths` frontmatter field load unconditionally for all files, at the same priority as `.claude/CLAUDE.md`.
- Rules with `paths` load only when Claude works with matching files (trigger on read of a matching file, not on every tool use):

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Development Rules
- All API endpoints must include input validation
```

- Glob patterns in `paths`; brace expansion matches multiple extensions:

| Pattern | Matches |
|---|---|
| `**/*.ts` | All TypeScript files in any directory |
| `src/**/*` | All files under `src/` |
| `*.md` | Markdown files in project root |
| `src/components/*.tsx` | React components in a specific directory |
| `src/**/*.{ts,tsx}` | Both extensions under `src/` (brace expansion) |

- User-level rules: `~/.claude/rules/` — apply to every project on the machine; loaded **before** project rules, so project rules win.
- Share across projects with symlinks (directories or individual files); circular symlinks are detected and handled gracefully.
- Debug: the `InstructionsLoaded` hook (`/en/hooks#instructionsloaded`) logs which instruction files load, when, and why — useful for path-specific/lazy-loaded rules.

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
