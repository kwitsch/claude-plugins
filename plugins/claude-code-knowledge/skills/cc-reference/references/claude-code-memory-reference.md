# Claude Code Memory — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (How Claude remembers your project), verified 2026-10-02.
> Apply when authoring or editing CLAUDE.md files or configuring auto memory.

## CLAUDE.md: what & when

- CLAUDE.md = plain-text markdown file loaded into every session's context window at startup.
- Use it to give Claude persistent instructions it would otherwise need re-explaining.
- Add to it when: Claude repeats a mistake a second time; a code review catches something Claude should've known about the codebase; you retype a correction/clarification you already gave last session; or a new teammate would need the same context to be productive.
- Do NOT use it as a scratchpad or project log; keep it to directives Claude must hold every session.
- Run `/init` to generate a starting CLAUDE.md automatically; Claude analyzes the codebase and creates build commands, test instructions, and project conventions it discovers. If a CLAUDE.md already exists, `/init` suggests improvements rather than overwriting. `/init` reads Cursor rules (`.cursor/rules/` or `.cursorrules`) and Copilot rules (`.github/copilot-instructions.md`) and incorporates relevant parts.
- `CLAUDE_CODE_NEW_INIT=1` (set in the shell or the `env` block of a settings file; only changes how `/init` runs, so it may stay set): enables interactive multi-phase `/init` — asks which artifacts to set up (CLAUDE.md/skills/hooks), explores via subagent, asks follow-ups, presents a reviewable proposal before writing. Only under this flag does `/init` additionally read `AGENTS.md`, `.devin/rules/`, `.windsurf/rules/` or `.windsurfrules`, and `.clinerules`; choosing its personal option creates `CLAUDE.local.md` and adds it to `.gitignore` for you.
- Target **under 200 lines** per CLAUDE.md file — longer files consume more context and reduce adherence. Over-long files → move instructions into path-scoped rules or trim content not needed every session; `@path` imports help organization but do NOT reduce context.
- Claude Code loads a CLAUDE.md file **up to 4 MiB** in full; a larger file is skipped entirely (not loaded at all).
- version >= 2.1.206: the `/doctor` checkup proposes trims for a checked-in CLAUDE.md — it cuts content Claude can derive from the codebase (directory layouts, dependency lists, architecture overviews) and keeps pitfalls, rationale, and conventions that differ from tool defaults.
- Size warnings: one instruction file over the recommended length → warning at startup and in `/status`. Files each within that length but adding up past a combined limit at session start → also a warning. Each CLAUDE.md, rules file, and `@path` import counts as a separate file.
- version >= 2.1.283: `/doctor prompt-audit [path]` audits instruction files for outdated/conflicting content (instructions written for older models, references to nonexistent files/commands, contradicting files); report-only until you ask Claude to apply the proposed edits. Default scope: CLAUDE.md, CLAUDE.local.md, AGENTS.md, plus rules, skills, commands, subagents, and output styles under `.claude/` and `~/.claude/`; pass a path to audit one file or directory (e.g. `/doctor prompt-audit .claude/skills/deploy`). Runs through the bundled `/claude-api` skill → unavailable while that skill is turned off in `skillOverrides` or via `disableBundledSkills`.
- CLAUDE.md instructions are context, not enforced configuration. To block an action regardless of Claude's decision, use a `PreToolUse` hook instead.
- CLAUDE.md content is delivered as a **user message after the system prompt**, not part of the system prompt — no guarantee of strict compliance, especially for vague/conflicting instructions.
- For system-prompt-level instructions, use `--append-system-prompt` (must be passed every invocation; suited to scripts/automation, not interactive use).
- Block-level HTML comments (`<!-- ... -->`) in CLAUDE.md are stripped before injection into context (use them for human-maintainer notes). Comments inside code blocks are preserved; the Read tool shows all comments.
- `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`: prevents loading any CLAUDE.md memory files into context, including user, project, and auto-memory files.

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
| **Project**        | `./CLAUDE.md` or `./.claude/CLAUDE.md` (see AGENTS.md section for when `./AGENTS.md` loads instead of or alongside them)                              | Team (via source control)  |
| **Local project**  | `./CLAUDE.local.md` (add to `.gitignore`)                                                                                                             | Just you (current project) |

- CLAUDE.md and CLAUDE.local.md files **in the directory hierarchy above the working directory** load in full at launch.
- Files **in subdirectories** load on demand when Claude reads files in those directories.
- Load ordering: Claude walks up the directory tree from cwd, concatenating all discovered files (not overriding). Ordered filesystem-root → cwd, so files closest to launch dir are read **last**. Within each directory, `CLAUDE.local.md` is appended **after** `CLAUDE.md`.
- Managed policy CLAUDE.md **cannot be excluded** by `claudeMdExcludes` — always loads.
- `claudeMd` key in `managed-settings.json` injects CLAUDE.md content directly; honored only in managed/policy scope. Setting it in user, project, or local settings has no effect.
- `claudeMdExcludes` skips files by path or glob (matched against absolute paths); configurable at **any** settings layer (user/project/local/managed); arrays merge across layers. Put it in `.claude/settings.local.json` to keep the exclusion local to your machine.
- version >= 2.1.239: to exclude a `.claude/rules/` file reached through a symlink, a pattern matching **either** the file's path under `.claude/rules/` **or** its link target excludes it (before v2.1.239, only a pattern matching the link target worked).
- `--add-dir` directories do NOT load their CLAUDE.md by default. Set `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` to load `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`, `CLAUDE.local.md` from them (`CLAUDE.local.md` skipped if `local` is excluded from `--setting-sources`).
- Compaction: project-root CLAUDE.md **survives `/compact`** — re-read from disk and re-injected. Nested subdirectory CLAUDE.md files and rules with `paths:` frontmatter are NOT re-injected automatically; they reload next time Claude reads a file in that subdirectory or a file matching the rule's patterns. An instruction missing after compaction was either given only in conversation (never written to a file), lives in a nested CLAUDE.md that hasn't reloaded yet, or is a path-scoped rule that hasn't matched a file since — put conversation-only instructions into a CLAUDE.md to make them persist.
- Debug: run `/context` and read the list under **Memory files** to confirm a CLAUDE.md/CLAUDE.local.md file actually loaded in the session — a file missing there is invisible to Claude that session. `/memory` lists memory-file _locations_ and opens them for editing; `/context` is the load check.

### User-level rules

- `~/.claude/rules/` applies to every project on the machine.
- Loaded before project rules → a project rule appears later in context than a user rule. Neither set overrides the other: if a user rule and a project rule conflict, Claude may follow either → keep them consistent.

## Imports (@path syntax, recursion depth, home-dir imports)

- Syntax: `@path/to/file` anywhere in a CLAUDE.md file.
- Both relative and absolute paths are allowed.
- Relative paths resolve relative to the **importing file**, not the working directory.
- Imported files are expanded and loaded into context at launch (not on demand). Imports do NOT reduce context — imported files load at launch.
- Recursive imports are allowed; **maximum depth: 4 hops**.
- Path containing spaces → put a backslash before each space (`@Design\ Docs/api-conventions.md`). Unescaped, the path ends at the first space (even when the import is alone on its line). A quoted path is not imported at all, with or without backslashes.
- Import parsing **skips Markdown code spans and fenced code blocks**. Wrap a path in backticks (`` `@README` ``) to keep it literal; `@README` outside backticks imports.
- A gitignored `CLAUDE.local.md` exists only in the worktree where it was created → to share personal instructions across git worktrees of the same repo, import from the home directory:

```text
# Individual Preferences
- @~/.claude/my-project-instructions.md
```

- An import in a **project-level** memory file counts as _external_ when its path resolves outside the working directory (e.g. the home-directory import above). First encounter of external imports in a project: Claude shows an approval dialog listing the files; declining disables the imports and the dialog does not reappear. The dialog guards against files other people commit to a shared project.
- Imports in **user-scope** memory files (`~/.claude/CLAUDE.md`, `~/.claude/rules/`) load without the dialog — same trust level as the rest of your personal configuration. Exception — Cowork sessions on desktop: skip any user-scope import resolving to a path outside the session's working directory (rest of the file still loads), and also skip a `~/.claude/CLAUDE.md` that is itself a symlink/hard link and a symlinked `~/.claude/rules/` directory or rule file pointing outside the working directory.
- Imported files still load at launch and consume context window tokens.

### AGENTS.md

- version >= 2.1.277: Claude Code reads `AGENTS.md` directly as project instructions (no `CLAUDE.md`, import, or setting needed). Default behavior by repository contents:

| Repository has                                                                | Claude reads                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------- |
| `AGENTS.md`, no `CLAUDE.md`/`CLAUDE.local.md` in working directory or above   | `AGENTS.md`                                   |
| `AGENTS.md` and a `CLAUDE.md`/`CLAUDE.local.md` in working directory or above | `CLAUDE.md` files only                        |
| `CLAUDE.md` that already imports `AGENTS.md` (`@AGENTS.md`)                   | `CLAUDE.md`, with `AGENTS.md` included via it |

- Counts as "has a CLAUDE.md" (so `AGENTS.md` is NOT read): `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` in working directory or any directory above it. Does NOT count (keeps loading alongside `AGENTS.md`): `~/.claude/CLAUDE.md`, managed `CLAUDE.md`, `.claude/rules/` files.
- A `CLAUDE.local.md` added in an `AGENTS.md`-only project stops Claude reading `AGENTS.md` → set **Project instructions** to `claude-md-and-agents-md` to keep both.
- What gets read when none count: at session start, every `AGENTS.md` and `.claude/AGENTS.md` in working directory and above (interactive session shows a line like `no CLAUDE.md found; AGENTS.md loaded: <path>`); in subdirectories, a subdirectory's `AGENTS.md` when Claude opens a file there with the Read tool and that subdirectory has none of the three `CLAUDE.md` files. `@path` imports inside it expand, `claudeMdExcludes` applies, and subagents that skip project instructions skip it too. Not read: `AGENTS.local.md`, `AGENTS.override.md`, anything under `.agents/`.

#### Project instructions setting

Set in `/config` (**Project instructions**) or via `pluginConfigs` under the built-in `agents-md` plugin ID in `~/.claude/settings.json`, a `--settings` file, or managed settings. Ignored in project and local settings files. Applies from the next message and in every new session.

```json
{
  "pluginConfigs": {
    "agents-md@builtin": {
      "options": { "instructionFiles": "claude-md-and-agents-md" }
    }
  }
}
```

| Value                     | What Claude reads                                                                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-md-or-agents-md`  | Default. `CLAUDE.md` files, or `AGENTS.md` files when no `CLAUDE.md`/`CLAUDE.local.md` in working directory or above                                                                                                                                  |
| `claude-md-and-agents-md` | `CLAUDE.md` and `AGENTS.md` together, each directory's `CLAUDE.md` files first then its `AGENTS.md`; an `AGENTS.md` already loaded (imported/symlinked by `CLAUDE.md`) is skipped, not read twice                                                     |
| `claude-md`               | `CLAUDE.md` files only                                                                                                                                                                                                                                |
| `managed-only`            | Only managed `CLAUDE.md` and auto memory at launch; project/local/user `CLAUDE.md`, `.claude/rules/`, and every `AGENTS.md` left out. Subdirectory `CLAUDE.md`/`.claude/rules/` files and path-scoped rules still load when Claude reads a file there |

#### When AGENTS.md support is unavailable

Claude reads `CLAUDE.md` files only, and **Project instructions** is absent from `/config`, when:

- Claude Code version is before v2.1.277.
- The built-in `agents-md` plugin is disabled in `/plugin`.
- In some cases, the first session after upgrading from v2.1.276 or earlier (read from the next session on).
- Before v2.1.281, some sessions (e.g. Amazon Bedrock, telemetry disabled) read `CLAUDE.md` files only → update.

In those sessions import `AGENTS.md` from a `CLAUDE.md` (below).

#### AGENTS.md vs CLAUDE.md behavior

| Aspect                                                                   | `CLAUDE.md`                                 | `AGENTS.md` read through the setting                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `InstructionsLoaded` hooks                                               | Fire                                        | Don't fire (they do fire for an `AGENTS.md` that a `CLAUDE.md` imports or symlinks to) |
| `--add-dir` dirs with `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` set | Their `CLAUDE.md` loads                     | Their `AGENTS.md` doesn't load                                                         |
| `@path` import of a file outside the working directory                   | Claude asks you to approve external imports | Loads only if external imports were already approved for the project, no prompt        |

- version >= 2.1.280: `/memory` and `/context` list an `AGENTS.md` that Claude read directly. Before v2.1.280 they didn't → ask Claude what its project instructions say.

#### Remove an earlier AGENTS.md workaround

- `CLAUDE.md` containing `@AGENTS.md`: may stay (never reads twice, whichever value is set). Delete the `CLAUDE.md` if it holds nothing else; keep it if some sessions can't load `AGENTS.md` directly.
- `CLAUDE.md` that tells Claude in words to read `AGENTS.md`: Claude sees it only if it decides to open the file → delete the `CLAUDE.md`, or replace the sentence with an `@AGENTS.md` import.
- `CLAUDE.md` symlinked to `AGENTS.md`: nothing needed, or delete the symlink (content read once either way).
- `SessionStart` hook that prints `AGENTS.md`: remove it (adds a second copy once Claude reads `AGENTS.md` directly).

#### Share one file with other coding tools

- Use when the project also has a `CLAUDE.md`, **Project instructions** is `claude-md`, or the session can't load `AGENTS.md`: create a `CLAUDE.md` that imports it (`@AGENTS.md`) — add Claude-specific instructions below the import (Claude reads the imported file first). Or symlink (`ln -s AGENTS.md CLAUDE.md`) if no Claude-specific content is needed.
- Symlink constraints: Claude reads `CLAUDE.md` through the link, but Edit/Write refuse to write through a symlink and direct Claude to edit the link target (`AGENTS.md`).
- Windows (anyone on the repo): use the `@AGENTS.md` import. Symlinks need Administrator/Developer Mode, and Git checks a committed symlink out as a plain-text file unless `core.symlinks` is enabled, leaving a one-line `CLAUDE.md` in place of your instructions.
- Confirm in the next session with `/context` → `CLAUDE.md` under **Memory files**.
- version >= 2.1.213: `/import` brings a supported coding agent's configuration into Claude Code — appends a one-time copy of instruction files such as `AGENTS.md` to the matching CLAUDE.md and carries over MCP servers, commands, subagents, and skills.

## Auto memory

- Auto memory = notes Claude writes itself, based on corrections, preferences, and patterns it discovers.
- Claude decides what to save; it does not write something every session.
- Machine-local; not shared across machines or cloud environments.
- All worktrees and subdirectories in the same git repo share one auto memory directory.
- The main conversation's auto memory is **not** loaded into subagents; the exception is a **fork**, which inherits the parent conversation and system prompt. A subagent's own auto memory (enabled via the subagent `memory` field) is a separate directory — see subagent docs `/en/sub-agents#enable-persistent-memory`.
- version >= 2.1.59: feature requires at least this Claude Code version (`claude --version`).

### Memory kinds

Claude records the kind it is saving as a `type` field in the memory file's frontmatter:

| Type        | Content                                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| `user`      | Your role, expertise, and working preferences                                       |
| `feedback`  | Corrections you give Claude and approaches you confirm                              |
| `project`   | Ongoing work, deadlines, and decisions Claude can't derive from code or git history |
| `reference` | Where to find information outside the project (issue tracker, dashboard, etc.)      |

- Claude skips saving anything it can derive from the codebase (architecture, file paths, debugging fixes) and anything the CLAUDE.md files already say.

### Storage location

Default path: `~/.claude/projects/<project>/memory/` where `<project>` is derived from the git repository root. Outside a git repo, the project root is used.

```text
~/.claude/projects/<project>/memory/
├── MEMORY.md           # concise index; loaded into every session
├── user_role.md        # one memory (type: user)
├── feedback_testing.md # one memory (type: feedback)
└── ...                 # any other topic files Claude creates
```

- version >= 2.1.234: setting `CLAUDE_CODE_PROJECT_DIR_NAME` alongside `CLAUDE_CONFIG_DIR` makes Claude Code use that fixed name as the `<project>` directory under `<config dir>/projects/`, regardless of which repository launches Claude Code — every project launched with that config directory then shares one auto memory directory.
- Auto memory files (`MEMORY.md` + topic files) are excluded from the `cleanupPeriodDays` session-transcript retention sweep — they persist until you or Claude edits or deletes them, unlike session transcripts.
- `MEMORY.md` is the entry point and acts as the index of the memory directory; first **200 lines or 25 KB** (whichever comes first) load at session start. Content past that threshold is **not** loaded at session start.
- This 200-line/25 KB limit applies **only to `MEMORY.md`**. CLAUDE.md files load in full up to **4 MiB**; a larger file is skipped entirely (shorter files still produce better adherence).
- version >= 2.1.210: after each write to `MEMORY.md`, Claude Code measures the file against the 200-line/25 KB read limits. Near a limit → Claude is reminded to shorten it (one line per entry, detail into topic files, merge or drop stale entries). Over a limit → the write still succeeds, but Claude Code returns an error telling Claude to rewrite the index, because everything past the limit is dropped on the next load.
- version >= 2.1.211: the limit check measures only the content that loads — YAML frontmatter and block-level HTML comments are stripped before the index loads, so they do not count toward the limits.
- version >= 2.1.214: when Claude writes a memory file that begins with YAML frontmatter, Claude Code records the write time in a `modified` frontmatter field (ISO 8601). Any file that already has frontmatter gets the field on its next write, including files created on earlier versions; Claude Code never adds frontmatter to a file that has none.
- Topic files (e.g., `user_role.md`) are **not** loaded at startup; Claude reads them on demand with its standard file tools.
- Override storage path with `autoMemoryDirectory` in settings:

```json
{
  "autoMemoryDirectory": "~/my-custom-memory-dir"
}
```

Value must be an absolute path or start with `~/`. Read from **any** settings scope (user/project/local/policy/`--settings`). When set in a project's `.claude/settings.json` or `.claude/settings.local.json`, honored only after the workspace trust dialog is accepted (same gate as hooks).

- While `permissions.blockReadsOutsideWorkingDirectories` is on, Claude Code loads no auto memory from — and saves none to — a directory that a repository-supplied settings file points `autoMemoryDirectory` at, wherever that directory sits.

### Enable / disable

- On by default in local sessions. Outside Claude Tag sessions, a session in a self-hosted environment runs with auto memory **off** by default.
- Toggle via `/memory` → auto memory toggle in session; the toggle writes `autoMemoryEnabled` to **user** settings (`~/.claude/settings.json`).
- The toggle turns auto memory off but cannot turn it back on in a background session or in a session another Claude Code session started (e.g. Claude running `claude` through its Bash tool). There the toggle reads `off · can't be turned on here; use a session started outside Claude Code` → run `claude` directly in a terminal and use the `/memory` toggle in that session.
- To disable for a single project, set `autoMemoryEnabled` in that project's settings:

```json
{
  "autoMemoryEnabled": false
}
```

- Environment variable: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. Set to `0` to force auto memory on even when `--bare` mode or `autoMemoryEnabled: false` would otherwise disable it.

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
- Use managed settings for hard enforcement; CLAUDE.md is guidance, not enforcement. Managed settings enforcement keys:

| Concern                                  | Key(s)                                  |
| ---------------------------------------- | --------------------------------------- |
| Block specific tools, commands, or paths | `permissions.deny`                      |
| Enforce sandbox isolation                | `sandbox.enabled`                       |
| Environment variables / API routing      | `env`                                   |
| Login method / org restrictions          | `forceLoginMethod`, `forceLoginOrgUUID` |

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

- Rule frontmatter: `paths` is the only field Claude Code reads from a rule; any other field is ignored without an error. Frontmatter is removed before the rule loads into context.

| Field   | Required | Description                                                                           |
| ------- | -------- | ------------------------------------------------------------------------------------- |
| `paths` | No       | Glob patterns scoping the rule to matching files. YAML list or comma-separated string |

- Unparseable YAML between the `---` markers → frontmatter is ignored and the rule loads as if it had no `paths` (unconditional). Run `claude --debug` to see the parse error.
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
- User-level rules: `~/.claude/rules/` — apply to every project on the machine; loaded **before** project rules (project rule appears later in context), but neither set overrides the other; conflicting rules → Claude may follow either.
- Share across projects with symlinks (directories or individual files); circular symlinks are detected and handled gracefully.
- A symlink under `.claude/rules/` whose **target** resolves outside the working directory is treated like an external import: the linked rules don't load until you approve external imports for the project, and once approved only the ones without a `paths` field load. Claude Code asks for that approval only when a project memory file imports a file outside the working directory with `@path` — a symlink alone doesn't trigger the dialog. To load shared rules with no approval step, keep them in `~/.claude/rules/` instead (applies to every project on the machine).
- A `.claude/rules/` or `CLAUDE.md` symlink pointing at a network path (UNC share `\\server\share`, or a path under `/net` or `/Network`) → linked instructions don't load; Claude Code doesn't follow the link because looking up such a path can contact the named host. `\\wsl$` paths don't count as network paths.
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

## Troubleshooting

- Claude not following CLAUDE.md → check in order: `/context` **Memory files** list shows the file; file sits in a location loaded for the session; instructions are specific; no conflicting instructions across CLAUDE.md files; your instruction doesn't compete with built-in Claude Code guidance.
- Competing built-in guidance: if CLAUDE.md sets commit or pull request rules, turn off the built-in ones with `includeGitInstructions` and set the attribution text with `attribution`.
- Instruction that must run at a fixed point (before every commit, after each file edit) → write it as a hook, not CLAUDE.md. Hooks run as shell commands at lifecycle events regardless of what Claude decides.
- `AGENTS.md` not loading → (1) a `CLAUDE.md`/`.claude/CLAUDE.md`/`CLAUDE.local.md` in working directory or above (other than `~/.claude/CLAUDE.md`) wins unless **Project instructions** is `claude-md-and-agents-md`; (2) `claude --version` must be v2.1.277 or later (v2.1.281 or later for Bedrock/telemetry-disabled sessions); (3) `/config` **Project instructions** must not be `claude-md` or `managed-only` (setting absent → session can't load `AGENTS.md`). Confirm via `/memory` path list.
- Unknown auto memory contents → `/memory` → open auto memory folder; plain markdown, edit/delete freely.
- Instruction lost after `/compact` → given only in conversation, in a nested CLAUDE.md not yet reloaded, or in a path-scoped rule that hasn't matched a file since → write conversation-only instructions into CLAUDE.md.
- `--append-system-prompt` for system-prompt-level instructions; passed at launch, suited to scripts/automation.

## Version notes

| Version gate       | Note                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| version >= 2.1.59  | Auto memory feature available; verify with `claude --version`                                                                                  |
| version >= 2.1.198 | Path-scoped `.claude/rules/` `paths` matching also works through a symlinked path to the project directory (e.g. a symlinked checkout)         |
| version >= 2.1.206 | `/doctor` checkup proposes trims for a checked-in CLAUDE.md (cuts codebase-derivable content, keeps pitfalls/rationale/conventions)            |
| version >= 2.1.210 | Claude Code measures `MEMORY.md` against the 200-line/25 KB read limits after each write; reminder near a limit, error over a limit            |
| version >= 2.1.213 | `/import` copies a supported coding agent's config (e.g. `AGENTS.md`, MCP servers, commands, subagents, skills) into Claude Code               |
| version >= 2.1.214 | `modified` ISO 8601 write-time frontmatter field added to memory files that already have frontmatter                                           |
| version >= 2.1.234 | `CLAUDE_CODE_PROJECT_DIR_NAME` (set alongside `CLAUDE_CONFIG_DIR`) fixes the auto-memory `<project>` directory name regardless of launch repo  |
| version >= 2.1.239 | `claudeMdExcludes` pattern matches a symlinked rule by either its `.claude/rules/` path or its link target                                     |
| version >= 2.1.277 | `AGENTS.md` read directly as project instructions (default `claude-md-or-agents-md`); `Project instructions` setting in `/config`              |
| version >= 2.1.280 | `/memory` and `/context` list an `AGENTS.md` that Claude read directly                                                                         |
| version >= 2.1.281 | Bedrock/telemetry-disabled sessions also read `AGENTS.md` directly                                                                             |
| version >= 2.1.283 | `/doctor prompt-audit` audits instruction files (runs through the bundled `/claude-api` skill)                                                 |
| before v2.1.207    | One invalid `[` pattern in a rule's `paths` made the Read tool fail for every file the rule was evaluated against, instead of matching nothing |
| before v2.1.211    | `MEMORY.md` limit check measured the raw file, so frontmatter/HTML comments could trigger the error even when the loaded content fit           |
| before v2.1.211    | On-demand rules (path-scoped rules, rules in nested `.claude/rules/`) loaded even when `project` was excluded from `--setting-sources`         |
| before v2.1.216    | `/memory` waited for the opened file to be closed before responding; from v2.1.216 it returns immediately for GUI editors                      |
| before v2.1.217    | A `paths` value with many brace groups stalled or crashed the CLI at startup                                                                   |
| before v2.1.239    | A `claudeMdExcludes` pattern excluded a symlinked rule only when it matched the link target, not the file's own `.claude/rules/` path          |
| before v2.1.280    | `/memory` and `/context` didn't list an `AGENTS.md` that Claude read directly                                                                  |
| before v2.1.281    | Some sessions (Amazon Bedrock, telemetry disabled) read `CLAUDE.md` files only, not `AGENTS.md`                                                |
