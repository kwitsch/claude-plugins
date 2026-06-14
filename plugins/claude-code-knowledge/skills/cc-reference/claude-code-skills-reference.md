# Claude Code Skills — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (Skill authoring best practices + Claude Code Skills), verified 2026-06.
> Apply when authoring, reviewing, or refactoring a `SKILL.md`.

## What a skill is / when to choose it

- Skill = directory with `SKILL.md` (required) + optional bundled files (refs, scripts, templates).
- Loads on demand: only `name`+`description` are pre-loaded; body loads when invoked/relevant; bundled files load only when read.
- Choose a skill when: repeating the same instructions/checklist/procedure, or a CLAUDE.md section has grown into a *procedure* (not a fact).
- Skill vs alternatives:
  - **CLAUDE.md** → always-on facts/conventions that must persist. Skills → procedures loaded on demand.
  - **Subagent** → isolated context, separate tool/permission scope, returns a summary. Skill → runs inline in main context (unless `context: fork`).
  - Custom commands (`.claude/commands/*.md`) are merged into skills; both create `/name`. Skills are the recommended path (support bundled files + extra frontmatter).

## Discovery & progressive disclosure (mechanics)

1. Startup: `name`+`description` of every skill injected into context (an `<available_skills>` list).
2. On match/invoke: full `SKILL.md` body enters context as one message.
3. Bundled files: read only when referenced and needed → zero context cost until accessed.
- Keep `SKILL.md` body **under 500 lines**. Split into separate files past that.
- Description budget: combined `description`+`when_to_use` truncated at **1,536 chars** per skill in the listing (cap configurable via `maxSkillDescriptionChars`). Listing budget scales at ~1% of model context (`skillListingBudgetFraction` / `SLASH_COMMAND_TOOL_CHAR_BUDGET`); on overflow, least-used skills' descriptions drop first. `/doctor` reports overflow.

## Frontmatter reference (Claude Code)

All fields optional; only `description` recommended. YAML between `---` markers.

| Field | Purpose |
|---|---|
| `name` | Display label in listings. Defaults to directory name. Does NOT set the `/command` except for a plugin-root SKILL.md. |
| `description` | What it does + when to use. Drives model invocation. Falls back to first paragraph if omitted. |
| `when_to_use` | Extra triggers/example phrases; appended to `description`; counts toward 1,536-char cap. |
| `argument-hint` | Autocomplete hint, e.g. `[issue-number]` or `[file] [format]`. |
| `arguments` | Named positional args for `$name` substitution. Space-separated string or YAML list; map by position. |
| `disable-model-invocation` | `true` → only the user can invoke (`/name`); removes description from context; blocks preload into subagents. |
| `user-invocable` | `false` → hidden from `/` menu; Claude-only (background knowledge). |
| `allowed-tools` | Pre-approve tools (no per-use prompt) while active. Does NOT restrict the pool. Space/comma string or YAML list. |
| `disallowed-tools` | Remove tools from the pool while active; clears on next user message. |
| `model` | Model for this turn while active (not saved); `/model` values or `inherit`. |
| `effort` | `low|medium|high|xhigh|max` while active; overrides session. Model-dependent. |
| `context` | `fork` → run skill in a forked subagent context. |
| `agent` | Subagent type when `context: fork` (`Explore`, `Plan`, `general-purpose`, or custom). Default `general-purpose`. |
| `hooks` | Hooks scoped to this skill's lifecycle. |
| `paths` | Glob patterns; auto-activate only on matching files. Comma string or YAML list. |
| `shell` | `bash` (default) or `powershell` for `!` injection (PowerShell needs `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`). |

Note: the SDK ignores `allowed-tools`; it is CLI-only. In the SDK, control access via `allowedTools` + `permissionMode: "dontAsk"`.

### Command-name mapping

| Location | Command name from |
|---|---|
| `~/.claude/skills/<dir>/SKILL.md` or `.claude/skills/<dir>/SKILL.md` | directory name |
| `.claude/commands/<file>.md` | file name w/o extension |
| `<plugin>/skills/<dir>/SKILL.md` | directory name, namespaced `plugin:dir` |
| plugin-root `<plugin>/SKILL.md` | frontmatter `name` (fallback: plugin dir name) |

## Core authoring principles

### Concise is key (context is a public good)
- Assume Claude is already smart. Add only context it lacks. Challenge each line: "Does this justify its token cost?"
- State *what to do*, not *how/why*. Body stays in context across turns → every line is recurring cost.
- Good: minimal code snippet, assume domain knowledge. Bad: explaining what a PDF is.

### Set degrees of freedom to task fragility
- **High freedom** (text instructions) — multiple valid approaches, context-dependent. E.g. code review.
- **Medium freedom** (pseudocode / parameterized scripts) — a preferred pattern with acceptable variation.
- **Low freedom** (exact scripts, no params) — fragile/critical/ordered ops. E.g. DB migrations: "Run exactly this; do not modify."
- Analogy: narrow bridge (low freedom) vs open field (high freedom).

### Test across all target models
- Haiku: enough guidance? Sonnet: clear+efficient? Opus: not over-explaining? Aim for instructions that work on all you ship to.

### Writing effective descriptions
- **Third person, always.** Injected into system prompt; mixed POV breaks discovery.
  - Good: "Processes Excel files and generates reports." Bad: "I can help you…" / "You can use this to…".
- Include both *what it does* and *when to use it* (specific triggers, file types, key terms).
- Put the key use case first (1,536-char truncation). Avoid vague: "Helps with documents", "Processes data".

### Naming conventions
- Prefer gerund form: `processing-pdfs`, `analyzing-spreadsheets`, `testing-code`.
- Acceptable: noun phrase (`pdf-processing`), action (`process-pdfs`).
- Avoid: `helper`, `utils`, `tools`, `data`, `files`; reserved words `anthropic`/`claude`; inconsistent patterns.
- `name`: lowercase letters/numbers/hyphens; ≤64 chars; no XML tags; no reserved words. `description`: non-empty, ≤1024 chars (API constraint), no XML tags.

## Progressive disclosure patterns

- **Pattern 1 — High-level guide + references:** SKILL.md = quick start + "See [FORMS.md], [REFERENCE.md], [EXAMPLES.md]".
- **Pattern 2 — Domain-split:** `reference/{finance,sales,product}.md`; SKILL.md routes by domain; offer `grep` for lookup.
- **Pattern 3 — Conditional details:** show basics inline; link advanced (tracked changes, OOXML) for load-on-demand.
- **References one level deep from SKILL.md.** Nested refs (A→B→C) cause partial reads (`head -100`) and incomplete info.
- **TOC for reference files >100 lines** so partial reads still reveal full scope.

## Workflows & feedback loops

- Break complex tasks into explicit sequential steps. For long workflows, provide a copy-able checklist Claude checks off.
- **Validation loop** (raises quality): run validator → fix → repeat. Validator can be a script OR a reference doc (e.g. compare against `STYLE_GUIDE.md`). "Only proceed when validation passes."
- **Conditional workflow:** route at decision points ("Creating? → workflow A. Editing? → workflow B").
- If a workflow gets large, push it to a separate file and tell Claude to read the right one for the task.

## Content guidelines

- **No time-sensitive info** ("before August 2025 use…"). Use a "Current method" section + a collapsed `<details>` "Old patterns (deprecated)" block.
- **Consistent terminology:** pick one term and reuse (always "field", always "extract"); don't mix synonyms.

## Common patterns

- **Template pattern:** provide an output template; match strictness (ALWAYS this structure ↔ "sensible default, use judgment").
- **Examples pattern:** for style-dependent output, give input/output pairs (e.g. commit-message format) — clearer than description alone.

## Skills with executable code

- **Solve, don't punt.** Scripts handle their own errors (FileNotFound → create default; PermissionError → fallback), not "let Claude figure it out".
- **No voodoo constants.** Justify/document every config value (`REQUEST_TIMEOUT = 30  # slow-connection budget`), never `TIMEOUT = 47  # ?`.
- **Provide utility scripts** even when Claude could write them: more reliable, save tokens (not loaded into context), faster, consistent.
- **State execution intent:** "Run `analyze_form.py`" (execute) vs "See `analyze_form.py` for the algorithm" (read). Prefer execute.
- **Verifiable intermediate outputs** ("plan → validate → execute"): for batch/destructive/high-stakes ops, write a plan file (`changes.json`), validate with a verbose script (list valid fields on error), then apply.
- **Dependencies:** never assume installed. List required packages; verify availability. claude.ai code-exec can install npm/PyPI + pull GitHub; Claude API code-exec has NO network / no runtime install.
- **Visual analysis:** render inputs to images (`pdf_to_images.py`) and let Claude inspect layout/fields visually.

## MCP tool references

- Always fully qualify: `ServerName:tool_name` (e.g. `GitHub:create_issue`, `BigQuery:bigquery_schema`). Bare names fail when multiple servers are present.

## Invocation control matrix

| Frontmatter | User invoke | Claude invoke | Context loading |
|---|---|---|---|
| (default) | Yes | Yes | description always in context; body on invoke |
| `disable-model-invocation: true` | Yes | No | description NOT in context; body on user invoke |
| `user-invocable: false` | No | Yes | description always in context; body on invoke |

- Side-effect/timing-sensitive actions (`/deploy`, `/commit`, `/send-slack-message`) → `disable-model-invocation: true`.
- Background knowledge (e.g. `legacy-system-context`) → `user-invocable: false`.

## Skill content lifecycle

- Invoked SKILL.md enters as one message and persists for the session; Claude does NOT re-read the file on later turns → write standing instructions, not one-time steps.
- Auto-compaction: re-attaches most recent invocation of each skill, keeping first **5,000 tokens** each; combined re-attach budget **25,000 tokens**, filled newest-first → older skills may drop. If behavior fades post-compaction, re-invoke the skill.
- If a skill "stops working", content is usually still present; strengthen `description`/instructions or enforce via hooks.

## Dynamic context injection (CLI feature)

- Inline `` !`<command>` `` runs the shell command BEFORE Claude sees content; output replaces the placeholder (preprocessing, not a Claude action).
  - Recognized only at line start or after whitespace; `KEY=!`cmd`` is literal.
  - Single pass; injected output is not re-scanned for further placeholders.
- Multi-line: fenced ` ```! ` block.
- Disable via `disableSkillShellExecution: true` (managed settings); bundled/managed skills unaffected.

### Substitutions
- `$ARGUMENTS` (full string; appended as `ARGUMENTS: …` if absent), `$ARGUMENTS[N]` / `$N` (0-based, shell-quoted), `$name` (from `arguments`).
- `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}` (`low|medium|high|xhigh|max`; ultracode reports `xhigh`), `${CLAUDE_SKILL_DIR}` (skill's own dir — use for bundled script paths so they resolve at any scope).
- Escape literal `$1.00` as `\$1.00`.

## context: fork (run in a subagent)

- Skill body becomes the subagent's task prompt; no access to conversation history; only a summary returns.
- Only meaningful for skills with an explicit task. Pure guideline skills under fork → no actionable prompt → empty result.
- With `agent: Explore`/`Plan`, CLAUDE.md + git status are skipped (small context); `general-purpose`/custom load CLAUDE.md.
- Inverse direction = subagent `skills:` field (preloads full skill content into a subagent at startup).

## Where skills live / precedence

| Scope | Path | Applies to |
|---|---|---|
| Enterprise | managed settings dir | whole org |
| Personal | `~/.claude/skills/<name>/SKILL.md` | all your projects |
| Project | `.claude/skills/<name>/SKILL.md` | this project |
| Plugin | `<plugin>/skills/<name>/SKILL.md` | where plugin enabled |

- Precedence on name clash: enterprise > personal > project. Plugin skills are `plugin:skill` namespaced (no clash). Skill beats same-named command.
- Project skills load from `.claude/skills/` in cwd and every parent up to repo root; nested package skills (`packages/x/.claude/skills/`) load on demand (monorepo support).
- `--add-dir`/`/add-dir`: `.claude/skills/` IS loaded (exception); `permissions.additionalDirectories` setting does NOT load skills. Other config (agents/commands/output-styles) not loaded from added dirs.
- Live change detection: edits to watched `SKILL.md` apply mid-session; a brand-new top-level skills dir needs a restart. Plugin-folder `hooks/`/`.mcp.json`/`agents/` changes need `/reload-plugins`.

## Permissions / access control

- `allowed-tools` grants no-prompt use while active; for project skills it activates only after accepting the workspace trust dialog. Review project skills before trusting a repo (a skill can self-grant broad access).
- Control which skills Claude may invoke:
  - Deny `Skill` tool entirely; or allow/deny specific: `Skill(commit)`, `Skill(review-pr *)`, `Skill(deploy *)` (exact vs prefix).
  - `disable-model-invocation: true` removes a skill from Claude's context entirely (`user-invocable` only affects menu visibility).
- `skillOverrides` (settings, written by `/skills`): per-skill `"on" | "name-only" | "user-invocable-only" | "off"`; absent = `"on"`. Plugin skills managed via `/plugin`, not this.

## Evaluation & iterative development

- **Build evals first.** 1) run task without skill, log failures; 2) create ≥3 scenarios; 3) baseline; 4) write minimal instructions to pass; 5) iterate vs baseline. (No built-in runner; eval JSON = `skills`, `query`, `files`, `expected_behavior`.)
- **Claude A / Claude B loop:** Claude A authors/refines; fresh Claude B uses it on real tasks; observe B's behavior; bring specifics back to A. Claude understands the skill format natively — no special "writing-skills" skill needed.
- Observe: unexpected exploration paths, missed reference links, over-relied sections (→ inline them), ignored files (→ remove or signal better). `name`+`description` are the most critical levers.

## Anti-patterns

- Windows paths — use forward slashes everywhere (`scripts/x.py`).
- Too many options — give one default + escape hatch ("Use pdfplumber; for scanned PDFs use pdf2image + pytesseract"), not a menu of 5 libs.
- Time-sensitive instructions; inconsistent terminology; deeply nested refs; assuming installed packages; narrating reasoning instead of stating actions.

## Pre-ship checklist

- [ ] `description` specific, third person, what + when, key use case first
- [ ] Body <500 lines; extra detail in separate files; refs one level deep; TOC if >100 lines
- [ ] No time-sensitive info; consistent terminology; concrete examples
- [ ] Scripts: handle errors, no voodoo constants, dependencies listed+verified, forward slashes, validation/feedback loops for critical ops
- [ ] MCP tools fully qualified (`Server:tool`)
- [ ] Invocation control set intentionally (`disable-model-invocation` / `user-invocable`)
- [ ] ≥3 evals; tested on Haiku/Sonnet/Opus + real usage

## Version / surface notes

- Commands merged into skills; `.claude/commands/*.md` still work with same frontmatter.
- `/run`, `/verify`, `/run-skill-generator` require Claude Code ≥ v2.1.145.
- `allowed-tools` is CLI-only (SDK ignores it). Use skills only from trusted sources; a malicious skill can direct tool/code execution. Skills feature is not ZDR-eligible.
