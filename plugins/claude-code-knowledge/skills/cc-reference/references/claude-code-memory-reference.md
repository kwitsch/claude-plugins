# Claude Code Memory — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (How Claude remembers your project), verified 2026-07-25.
> Apply when authoring or editing CLAUDE.md files or configuring auto memory.

## CLAUDE.md: what & when

- CLAUDE.md = plain-text markdown file loaded into every session's context window at startup.
- Use it to give Claude persistent instructions it would otherwise need re-explaining.
- Add to it when: Claude repeats a mistake a second time; a code review catches something Claude should've known about the codebase; you retype a correction/clarification you already gave last session; or a new teammate would need the same context to be productive.
- Do NOT use it as a scratchpad or project log; keep it to directives Claude must hold every session.
- Run `/init` to generate a starting CLAUDE.md automatically; Claude analyzes the codebase and creates build commands, test instructions, and project conventions it discovers. If a CLAUDE.md already exists, `/init` suggests improvements rather than overwriting. `/init` reads Cursor rules (`.cursor/rules/` or `.cursorrules`) and Copilot rules (`.github/copilot-instructions.md`) and incorporates relevant parts.
- `CLAUDE_CODE_NEW_INIT=1`: enables interactive multi-phase `/init` — asks which artifacts to set up (CLAUDE.md/skills/hooks), explores via subagent, asks follow-ups, presents a reviewable proposal before writing. Only under this flag does `/init` additionally read `AGENTS.md`, `.devin/rules/`, `.windsurf/rules/` or `.windsurfrules`, and `.clinerules`; choosing its personal option creates `CLAUDE.local.md` and adds it to `.gitignore` for you.
- Target **under 200 lines** per CLAUDE.md file — longer files consume more context and reduce adherence. Over-long files → move instructions into path-scoped rules or trim content not needed every session; `@path` imports help organization but do NOT reduce context.
- version >= 2.1.206: the `/doctor` checkup proposes trims for a checked-in CLAUDE.md — it cuts content Claude can derive from the codebase (directory layouts, dependency lists, architecture overviews) and keeps pitfalls, rationale, and conventions that differ from tool defaults.
- CLAUDE.md instructions are context, not enforced configuration. To block an action regardless of Claude's decision, use a `PreToolUse` hook instead.
- CLAUDE.md content is delivered as a **user message after the system prompt**, not part of the system prompt — no guarantee of strict compliance, especially for vague/conflicting instructions.
- For system-prompt-level instructions, use `--append-system-prompt` (must be passed every invocation; suited to scripts/automation, not interactive use).
- Block-level HTML comments (`<!-- ... -->`) in CLAUDE.md are stripped before injection into context (use them for human-maintainer notes). Comments inside code blocks are preserved; the Read tool shows all comments.

### Write effective instructions

- **Specificity**: concrete and verifiable: `"Use 2-space indentation"` not `"Format code properly"`; `"Run npm test before committing"` not `"Test your changes"`; `"API handlers live in src/api/handlers/"` not `"Keep files organized"`.
- **Structure**: markdown headers and bullets; organized sections are easier to follow than dense paragraphs.
- **Consistency**: two contradictory rules → Claude may pick one arbitrarily; review CLAUDE.md, nested CLAUDE.md files in subdirectories, and `.claude/rules/` periodically.
- In monorepos, use `claudeMdExcludes` to skip CLAUDE.md files from other teams.

## Locations & precedence

Files load in the order below (broadest to most specific); a later entry wins on conflict.

| Scope              | Location                                                                                                                                              | Shared with                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Managed policy** | Linux/WSL: `/etc/claude-code/CLAUDE.md`; macOS: `/Library/Application Support/ClaudeCode/CLAUDE.md`; Windows: `C:\Program Files\ClaudeCode\CLAUDE.md` | All users on machine       |
| **User**           | `~/.claude/CLAUDE.md`                                                                                                                                 | Just you (all projects)    |
| **Project**        | `./CLAUDE.md` or `./.claude/CLAUDE.md`                                                                                                                | Team (via source control)  |
| **Local project**  | `./CLAUDE.local.md` (add to `.gitignore`)                                                                                                             | Just you (current project) |

- CLAUDE.md and CLAUDE.local.md files **in the directory hierarchy above the working directory** load in full at launch.
- Files **in subdirectories** load on demand when Claude reads files in those directories.
- Load ordering: Claude walks up the directory tree from cwd, concatenating all discovered files (not overriding). Ordered filesystem-root → cwd, so files closest to launch dir are read **last**. Within each directory, `CLAUDE.local.md` is appended **after** `CLAUDE.md`.
- Managed policy CLAUDE.md **cannot be excluded** by `claudeMdExcludes` — always loads.
- `claudeMd` key in `managed-settings.json` injects CLAUDE.md content directly; honored only in managed/policy scope.
- `claudeMdExcludes` skips files by path or glob (matched against absolute paths); configurable at **any** settings layer (user/project/local/managed); arrays merge across layers. Put it in `.claude/settings.local.json` to keep the exclusion local to your machine.
- `--add-dir` directories do NOT load their CLAUDE.md by default. Set `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` to load `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`, `CLAUDE.local.md` from them (`CLAUDE.local.md` skipped if `local` is excluded from `--setting-sources`).
- Compaction: project-root CLAUDE.md **survives `/compact`** — re-read from disk and re-injected. Nested subdirectory CLAUDE.md files are NOT re-injected automatically; they reload next time Claude reads a file in that subdirectory. An instruction missing after compaction was either given only in conversation (never written to a file) or lives in a nested CLAUDE.md that hasn't reloaded yet — put conversation-only instructions into a CLAUDE.md to make them persist.
- Debug: run `/context` and read the list under **Memory files** to confirm a CLAUDE.md/CLAUDE.local.md file actually loaded in the session — a file missing there is invisible to Claude that session. `/memory` lists memory-file _locations_ and opens them for editing; `/context` is the load check.

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
- A gitignored `CLAUDE.local.md` exists only in the worktree where it was created → to share personal instructions across git worktrees of the same repo, import from the home directory:

```text
# Individual Preferences
- @~/.claude/my-project-instructions.md
```

- An import in a **project-level** memory file counts as _external_ when its path resolves outside the working directory (e.g. the home-directory import above). First encounter of external imports in a project: Claude shows an approval dialog listing the files; declining disables the imports and the dialog does not reappear. The dialog guards against files other people commit to a shared project.
- Imports in **user-scope** memory files (`~/.claude/CLAUDE.md`, `~/.claude/rules/`) load without the dialog — same trust level as the rest of your personal configuration.
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
- The main conversation's auto memory is **not** loaded into subagents; the exception is a **fork**, which inherits the parent conversation and system prompt. A subagent's own auto memory (enabled via the subagent `memory` field) is a separate directory — see subagent docs `/en/sub-agents#enable-persistent-memory`.
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

- `MEMORY.md` is the entry point and acts as the index of the memory directory; first **200 lines or 25 KB** (whichever comes first) load at session start. Content past that threshold is **not** loaded at session start.
- This 200-line/25 KB limit applies **only to `MEMORY.md`**. CLAUDE.md files load in full regardless of length (shorter files still produce better adherence).
- version >= 2.1.210: after each write to `MEMORY.md`, Claude Code measures the file against the 200-line/25 KB read limits. Near a limit → Claude is reminded to shorten it (one line per entry, detail into topic files, merge or drop stale entries). Over a limit → the write still succeeds, but Claude Code returns an error telling Claude to rewrite the index, because everything past the limit is dropped on the next load.
- version >= 2.1.211: the limit check measures only the content that loads — YAML frontmatter and block-level HTML comments are stripped before the index loads, so they do not count toward the limits.
- version >= 2.1.214: when Claude writes a memory file that begins with YAML frontmatter, Claude Code records the write time in a `modified` frontmatter field (ISO 8601). Any file that already has frontmatter gets the field on its next write, including files created on earlier versions; Claude Code never adds frontmatter to a file that has none.
- Topic files (e.g., `debugging.md`) are **not** loaded at startup; Claude reads them on demand with its standard file tools.
- Override storage path with `autoMemoryDirectory` in settings:

```json
{
  "autoMemoryDirectory": "~/my-custom-memory-dir"
}
```

Value must be an absolute path or start with `~/`. Read from **any** settings scope (user/project/local/policy/`--settings`). When set in a project's `.claude/settings.json` or `.claude/settings.local.json`, honored only after the workspace trust dialog is accepted (same gate as hooks).

### Enable / disable

- On by default.
- Toggle via `/memory` → auto memory toggle in session; the toggle writes `autoMemoryEnabled` to **user** settings (`~/.claude/settings.json`).
- To disable for a single project, set `autoMemoryEnabled` in that project's settings:

```json
{
  "autoMemoryEnabled": false
}
```

- Environment variable: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

## What belongs / what doesn't

| Belongs in CLAUDE.md               | Keep out of CLAUDE.md                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Build/test/lint commands           | Multi-step procedures (use a skill instead)                                        |
| Coding conventions and style rules | Derivable facts (directory structure Claude can discover)                          |
| Project architecture overview      | Information only relevant to one subdirectory (use `.claude/rules/` with `paths:`) |
| "Always do X" / "Never do Y" rules | Technical enforcement (use `permissions.deny` in managed settings)                 |
| Compliance/security reminders      | Frequently changing runtime data                                                   |

- Move a CLAUDE.md section to a skill when it becomes a multi-step procedure.
- Move it to a path-scoped rule when it only applies to specific file types.
- Use managed settings (`permissions.deny`, `sandbox.enabled`) for hard enforcement; CLAUDE.md is guidance, not enforcement.

### `.claude/rules/` for path-scoped rules

- Place rule files in `.claude/rules/` directory; one topic per file. All `.md` files are discovered **recursively** (organize into subdirs like `frontend/`, `backend/`).
- Rules without a `paths` frontmatter field load unconditionally at launch and apply to all files, at the same priority as `.claude/CLAUDE.md`.
- Project rules are skipped when `project` is excluded from `--setting-sources` (see Version notes).
- Rules load every session, or when matching files are opened. For task-specific instructions that need not sit in context permanently, use a **skill** instead — skills load only on invocation or when Claude judges them relevant to the prompt.
- Rules with `paths` load only when Claude works with matching files (trigger on read of a matching file, not on every tool use):

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Development Rules

- All API endpoints must include input validation
```

- version >= 2.1.198: path matching also works when Claude reaches a file through a **symlinked path** to the project directory (e.g. a symlinked checkout).
- Glob patterns in `paths`; brace expansion matches multiple extensions:

| Pattern                | Matches                                        |
| ---------------------- | ---------------------------------------------- |
| `**/*.ts`              | All TypeScript files in any directory          |
| `src/**/*`             | All files under `src/`                         |
| `*.md`                 | Markdown files in project root                 |
| `src/components/*.tsx` | React components in a specific directory       |
| `src/**/*.{ts,tsx}`    | Both extensions under `src/` (brace expansion) |

- Multiple patterns per rule are allowed. Brace-expansion budget: each brace group multiplies the expanded pattern count (`src/*.{ts,tsx}` → 2; `{a,b}/{c,d}/*.{ts,tsx}` → 8). A rule's whole `paths` list shares **one budget of 1,000 expanded patterns and 4 MiB**; brace-free patterns do not count against it. A pattern that would exceed the budget is used unexpanded, and its literal braces then match no files.
- Glob treats `[` as the start of a bracket expression (`[abc]`). A pattern whose `[` cannot be read as a bracket expression (e.g. `photos [2024/**`) is invalid: it matches nothing while the rule's other patterns keep working. Escape a literal `[` — `photos \[2024/**`.
- User-level rules: `~/.claude/rules/` — apply to every project on the machine; loaded **before** project rules, so project rules win.
- Share across projects with symlinks (directories or individual files); circular symlinks are detected and handled gracefully.
- Debug: the `InstructionsLoaded` hook (`/en/hooks#instructionsloaded`) logs which instruction files load, when, and why — useful for path-specific/lazy-loaded rules.

## Quick add & editing

| Action                           | How                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open memory viewer               | `/memory` — lists CLAUDE.md, CLAUDE.local.md, and other memory file **locations** across user and project scopes, including entries for files that do not exist yet |
| Check what actually loaded       | `/context` → **Memory files** list (`/memory` shows locations, not load state)                                                                                      |
| Toggle auto memory               | `/memory` → auto memory toggle (writes `autoMemoryEnabled` to `~/.claude/settings.json`)                                                                            |
| Open auto memory folder          | `/memory` → link to open folder                                                                                                                                     |
| Edit a memory file               | `/memory` → select file to open in editor; selecting one that does not exist creates it first                                                                       |
| Ask Claude to remember something | Tell Claude directly: `"always use pnpm, not npm"` → saved to auto memory                                                                                           |
| Add to CLAUDE.md instead         | Tell Claude: `"add this to CLAUDE.md"`, or edit via `/memory`                                                                                                       |
| Audit/delete memory              | Auto memory files are plain markdown; edit or delete at any time                                                                                                    |

- When you see "Saved 2 memories" or "Recalled 2 memories" in the interface, Claude is actively updating or reading `~/.claude/projects/<project>/memory/`.
- Terminal editors (e.g. Vim) take over the terminal until you exit. version >= 2.1.216: a GUI editor (e.g. VS Code) opens the file in a separate window and the session stays usable while it is open.

## Version notes

| Version gate       | Note                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| version >= 2.1.59  | Auto memory feature available; verify with `claude --version`                                                                                  |
| version >= 2.1.198 | Path-scoped `.claude/rules/` `paths` matching also works through a symlinked path to the project directory (e.g. a symlinked checkout)         |
| version >= 2.1.206 | `/doctor` checkup proposes trims for a checked-in CLAUDE.md (cuts codebase-derivable content, keeps pitfalls/rationale/conventions)            |
| version >= 2.1.210 | Claude Code measures `MEMORY.md` against the 200-line/25 KB read limits after each write; reminder near a limit, error over a limit            |
| version >= 2.1.214 | `modified` ISO 8601 write-time frontmatter field added to memory files that already have frontmatter                                           |
| before v2.1.207    | One invalid `[` pattern in a rule's `paths` made the Read tool fail for every file the rule was evaluated against, instead of matching nothing |
| before v2.1.211    | `MEMORY.md` limit check measured the raw file, so frontmatter/HTML comments could trigger the error even when the loaded content fit           |
| before v2.1.211    | On-demand rules (path-scoped rules, rules in nested `.claude/rules/`) loaded even when `project` was excluded from `--setting-sources`         |
| before v2.1.216    | `/memory` waited for the opened file to be closed before responding; from v2.1.216 it returns immediately for GUI editors                      |
| before v2.1.217    | A `paths` value with many brace groups stalled or crashed the CLI at startup                                                                   |
