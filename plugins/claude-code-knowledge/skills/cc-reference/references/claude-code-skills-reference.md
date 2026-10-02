# Claude Code Skills — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (Skill authoring best practices + Claude Code Skills + Agent Skills overview + Agent SDK skills), verified 2026-10-02.
> Apply when authoring, reviewing, or refactoring a `SKILL.md`.

## What a skill is / when to choose it

- Skill = directory with `SKILL.md` (required) + optional bundled files (refs, scripts, templates).
- Loads on demand: only `name`+`description` are pre-loaded; body loads when invoked/relevant; bundled files load only when read.
- Choose a skill when: repeating the same instructions/checklist/procedure, or a CLAUDE.md section has grown into a _procedure_ (not a fact).
- Skill vs alternatives:
  - **CLAUDE.md** → always-on facts/conventions that must persist. Skills → procedures loaded on demand.
  - **Subagent** → isolated context, separate tool/permission scope, returns a summary. Skill → runs inline in main context (unless `context: fork`).
  - Custom commands (`.claude/commands/*.md`) are merged into skills; both create `/name`. Skills are the recommended path (support bundled files + extra frontmatter).

## Discovery & progressive disclosure (mechanics)

1. Startup: `name`+`description` of every skill injected into context (an `<available_skills>` list; ~100 tokens per skill).
2. On match/invoke: full `SKILL.md` body enters context as one message.
3. Bundled files: read only when referenced and needed → zero context cost until accessed.

- Platform overview token costs: metadata ~100 tokens per skill (always loaded); `SKILL.md` body under 5k tokens (when triggered); bundled files none until accessed (scripts run through bash, only their output enters context).
- Keep `SKILL.md` body **under 500 lines**. Split into separate files past that.
- Description budget: combined `description`+`when_to_use` truncated at **1,536 chars** per skill in the listing (cap configurable via `skillListingMaxDescChars`). Listing budget scales at ~1% of model context (`skillListingBudgetFraction` / `SLASH_COMMAND_TOOL_CHAR_BUDGET`); on overflow the listing still contains every skill name and least-used skills' descriptions drop first (free budget by setting low-priority skills to `skillOverrides: name-only`), and Claude Code logs a warning to the debug log (`--debug`). `/doctor` reports overflow; v2.1.196+: `/context`'s Skills row reports the post-budget size (pre-v2.1.196 it counted full description text, which could read several times larger than `/doctor`'s budget).
- v2.1.252+: `/skill-doctor` reports each skill's context cost + invocation count and flags never-invoked skills to disable (via `skillOverrides`), covers every skill except bundled and enterprise skills, and also lists plugins not used recently — interactive sessions open it in `/plugin`'s Stats tab, `-p` prints it as text. Unavailable in sessions that skip feature-flag fetching; errors over Remote Control (`Skill usage reports are not available on this connection.`).

## Frontmatter reference (Claude Code)

All fields optional; only `description` recommended. YAML between `---` markers.
Frontmatter is read only when the opening `---` is the file's first line; otherwise the whole file, `---` markers included, is skill content. Field names are lowercase hyphenated except `when_to_use`; a field name must match the table exactly — an unrecognized field is ignored without an error.
v2.1.218+: boolean fields also accept `yes`/`no`/`on`/`off`/`1`/`0` in any letter case (pre-v2.1.218: only `true`/`false`).

| Field                      | Purpose                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Command name shown in the `/` menu. Defaults to directory name. Personal/project skill → sets the command you type (unless another command already uses the name); the directory name also invokes the skill. Plugin skill → sets the command's last segment.                                                                                     |
| `description`              | What it does + when to use. Drives model invocation. Falls back to the first non-empty line of the markdown content if omitted.                                                                                                                                                                                                                   |
| `when_to_use`              | Extra triggers/example phrases; appended to `description`; counts toward 1,536-char cap.                                                                                                                                                                                                                                                          |
| `argument-hint`            | Autocomplete hint, e.g. `[issue-number]` or `[file] [format]`.                                                                                                                                                                                                                                                                                    |
| `arguments`                | Named positional args for `$name` substitution. Space-separated string or YAML list; map by position.                                                                                                                                                                                                                                             |
| `disable-model-invocation` | `true` → only the user can invoke (`/name`); removes description from context; blocks preload into subagents; default `false`. v2.1.196+: also blocks the skill from running when a scheduled task fires with it as the prompt.                                                                                                                   |
| `user-invocable`           | `false` → hidden from `/` menu; Claude-only (background knowledge); default `true`.                                                                                                                                                                                                                                                               |
| `allowed-tools`            | Pre-approve tools (no per-use prompt) for the turn that invokes the skill; the grant clears on the next user message, re-invoking re-applies it. Does NOT restrict the pool. Space/comma string or YAML list.                                                                                                                                     |
| `disallowed-tools`         | Remove tools from the pool while active; clears on next user message. Cannot remove `EndConversation` while any other tool remains. Typical use: deny `AskUserQuestion` in an autonomous/background loop.                                                                                                                                         |
| `model`                    | Model for this turn while active (not saved); `/model` values or `inherit`; excluded by the org's `availableModels` allowlist, or unsupported in auto mode / plan mode's command classifier → ignored (session keeps its current model). With `context: fork`, sets the forked subagent's model instead (same exclusion rules).                   |
| `effort`                   | `low\|medium\|high\|xhigh\|max` while active; overrides session. Model-dependent.                                                                                                                                                                                                                                                                 |
| `context`                  | `fork` → run skill in a forked subagent context.                                                                                                                                                                                                                                                                                                  |
| `agent`                    | Subagent type when `context: fork` (`Explore`, `Plan`, `general-purpose`, or custom). Default `general-purpose`.                                                                                                                                                                                                                                  |
| `background`               | Only with `context: fork`. `false` → wait for the fork's result in the invoking turn instead of backgrounding it. Default `true`. Requires v2.1.218+.                                                                                                                                                                                             |
| `hooks`                    | Hooks scoped to this skill's lifecycle. Claude Code registers them when the skill is invoked and keeps them running for the rest of the session. See hooks docs for the config format and the `once` option.                                                                                                                                      |
| `paths`                    | Glob patterns; auto-activate only on matching files. Comma string or YAML list.                                                                                                                                                                                                                                                                   |
| `shell`                    | `bash` (default) or `powershell` for `!` injection. PowerShell tool default varies by surface: on by default on Windows without Git Bash, and (with Git Bash) for claude.ai/Console accounts; needs `CLAUDE_CODE_USE_POWERSHELL_TOOL=1` on Bedrock/Google Cloud Agent Platform/Microsoft Foundry and on macOS/Linux/WSL; set to `0` to force off. |
| `metadata`                 | Free-form YAML map for caller-defined data (entitlement/catalog fields, own tooling). Claude Code doesn't act on it; drops a non-map value. Don't reuse other frontmatter field names (e.g. `paths`) as keys.                                                                                                                                     |
| `license`                  | License string for the skill. Part of the Agent Skills spec; Claude Code accepts but doesn't act on it.                                                                                                                                                                                                                                           |
| `compatibility`            | Environment/prerequisite string, ≤500 chars. Part of the Agent Skills spec; Claude Code accepts but doesn't act on it.                                                                                                                                                                                                                            |

SDK sessions apply a project/personal skill's `allowed-tools` frontmatter the same as the CLI (synced skills follow their own frontmatter rules — see Synced skills below); layer a session-wide grant via the `allowedTools`/`allowed_tools` option on `ClaudeAgentOptions` — without a `canUseTool` callback anything not listed is denied (`permissionMode: "dontAsk"` states that explicitly). SDK skill discovery: `settingSources`/`setting_sources` must include `user` or `project` (else no skills load; both are loaded by default), scanning `.claude/skills/` in `cwd` plus every parent up to the repo root, plus `.claude/skills/` inside each directory passed via `additionalDirectories`/`add_dirs` (the SDK forwards those to Claude Code as `--add-dir`); the `skills` option filters them (`"all"` | name list | `[]`; omitted = discovered skills enabled and the `Skill` tool available, matching CLI), and setting it auto-adds the `Skill` tool to `allowedTools` — but if an explicit `tools` list is also passed, add `"Skill"` to it manually. `skills` is a context filter, not a sandbox: unlisted skills are hidden from the model and rejected by the `Skill` tool, but their files stay reachable via `Read`/`Bash`, and sending `/<name>` still dispatches a user-invocable skill even when its name is absent from the `skills` list. Skill name list validation (requires TS Agent SDK >=0.3.221 / Python Agent SDK >=0.2.129; earlier releases skipped the check): TS SDK throws / Python raises `ValueError` before starting if a name is empty, padded with whitespace, contains `()`, commas, or control chars, or uses a wildcard form (use `"all"` instead). Plugin skills load via the `plugins` option / `plugin:skill` names. The SDK `init` stream message (subtype `init`) includes a `skills` array of user-invocable loaded skills (skills with `user-invocable: false` load but don't appear there; the array lists everything discovered regardless of the `skills` allowlist, so a name your `skills` list excludes still appears there even though the `Skill` tool rejects invoking it) and a separate `slash_commands` array listing every dispatchable command (built-ins, bundled skills, user skills, `.claude/commands/` files) except terminal-only ones.

SDK session additions:

- Skills exist only as files on disk; the SDK has no programmatic API to register them (unlike subagents' `agents` option).
- `skills` name-list entries match the `name` field or the directory name; plugin skills use `plugin:skill`.
- The `init` `skills` array lists user-invocable skills defined with a `description` or `when_to_use` field, plus bundled skills.
- `Skill` tool on an unlisted skill → `Skill <name> is not in this session's skills allowlist`; fix by adding the name or by sending `/<name>`, which works without listing.
- `/<name>` matching no command in the session and no built-in: v2.1.274+ sends the prompt to Claude as an ordinary message with a note that the command didn't run (costs a model turn); before v2.1.274 it returned `Unknown command: /<name>` without a model turn. A `/<name>` matching a built-in unavailable in the session (e.g. `/theme`) returns `/theme isn't available in this environment.` without a model turn.
- `allowManagedPermissionRulesOnly` in managed settings: Claude Code ignores both a skill's `allowed-tools` and the `allowedTools` option.
- The SDK loads `.claude/commands/` and `~/.claude/commands/` files from the same two scopes (user, project) as skills. A command file named after a bundled skill (e.g. `.claude/commands/code-review.md`) shadows it; `slash_commands` lists the name once.

### Using skill frontmatter outside Claude Code

Skills follow the [Agent Skills](https://agentskills.io) open standard; Claude Code accepts every field above, but claude.ai skill uploads, the Skills API, and `package_skill.py` (anthropics/skills) allow only 6 spec fields: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`. A Claude-Code-only field (e.g. `argument-hint`) in one of those paths fails packaging/upload with a hard error: `Unexpected key(s) in SKILL.md frontmatter: argument-hint. Allowed properties are: allowed-tools, compatibility, description, license, metadata, name`. Enabling a personal skill for Cowork/cloud sessions uploads it to claude.ai, so the same 6-field restriction applies there too. Claude-Code-only body features (dynamic context injection, etc.) don't function in claude.ai chat or via the API.

### Command-name mapping

| Location                                                                  | Command name from                                                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `~/.claude/skills/<dir>/SKILL.md` or `.claude/skills/<dir>/SKILL.md`      | frontmatter `name`, else directory name (directory name also invokes it)                            |
| `.claude/commands/<file>.md`                                              | file name w/o extension                                                                             |
| `.claude/commands/<sub>/<file>.md`                                        | `<sub>` with each `/` → `:`, then file name (`frontend/component.md` → `/frontend:component`)       |
| `<plugin>/skills/<dir>/SKILL.md`                                          | frontmatter `name`, else directory name — namespaced `plugin:name`                                  |
| plugin-root `<plugin>/SKILL.md`                                           | frontmatter `name` (fallback: plugin dir name)                                                      |
| nested `.claude/skills/<dir>/SKILL.md` clashing with another skill's name | subdir path relative to cwd + dir name, e.g. `apps/web/.claude/skills/deploy/` → `/apps/web:deploy` |
| skill synced from claude.ai                                               | `anthropic-skills:<name>`; bare `/<name>` only while no other command uses it                       |

- `.claude/commands/*.md` files accept every frontmatter field above except `name` and `paths`.
- Plugin skill `name` replaces only the last segment: `my-plugin/skills/review/` with `name: fancy` → `/my-plugin:fancy`; bare `/fancy` also invokes it unless another command owns that name. Pre-v2.1.216: `name` replaced the whole command name (menu showed `/fancy` without the plugin prefix, and `/my-plugin:fancy` did not autocomplete).
- v2.1.246+: a `name` that already starts with the plugin's own prefix isn't doubled (`name: my-plugin:fancy` → `/my-plugin:fancy`). v2.1.216–v2.1.245: doubled the prefix in that case.
- Non-interactive sessions don't reserve `help`/`feedback` for their terminal-only built-ins, so a plugin skill named one of those keeps its bare command there; every other terminal-only built-in name (e.g. `/login`) stays reserved even though it can't run in that session. v2.1.216–v2.1.220: `help`/`feedback` were reserved too, so a plugin skill with one of those names needed its namespaced command in non-interactive sessions during that window.

## Core authoring principles

### Concise is key (context is a public good)

- Assume Claude is already smart. Add only context it lacks. Challenge each line: "Does this justify its token cost?"
- State _what to do_, not _how/why_. Body stays in context across turns → every line is recurring cost.
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
- Include both _what it does_ and _when to use it_ (specific triggers, file types, key terms).
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
- **Progress display → Task tools, not `TodoWrite`.** To surface step progress, instruct the skill to create one task per step with `TaskCreate`, then patch each with `TaskUpdate` (`status`: `pending`→`in_progress`→`completed`; `TaskList`/`TaskGet` read back; `status: deleted` removes). Task tools are the session default as of Claude Code v2.1.142 / TS Agent SDK 0.3.142, superseding the single-call `TodoWrite` (still forced via `CLAUDE_CODE_ENABLE_TASKS=0`). `TaskUpdate` patches one task by `taskId` (the id returns in the `TaskCreate` tool_result as `{ task: { id } }`), so a sub-skill's tasks append instead of overwriting the parent's — unlike `TodoWrite`, which rewrites the whole array each call. Source: <https://code.claude.com/docs/en/agent-sdk/todo-tracking>
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
- **Dependencies:** never assume installed. List required packages; verify availability. claude.ai code-exec can install npm/PyPI + pull GitHub; Claude API code-exec has NO network / no runtime install; Claude Code has full network access (same as any program on the user's machine) but install packages locally only — avoid global installs that could interfere with the user's system.
- **Visual analysis:** render inputs to images (`pdf_to_images.py`) and let Claude inspect layout/fields visually.

## MCP tool references

- Always fully qualify: `ServerName:tool_name` (e.g. `GitHub:create_issue`, `BigQuery:bigquery_schema`). Bare names fail when multiple servers are present.

## Invocation control matrix

| Frontmatter                      | User invoke | Claude invoke | Context loading                                 |
| -------------------------------- | ----------- | ------------- | ----------------------------------------------- |
| (default)                        | Yes         | Yes           | description always in context; body on invoke   |
| `disable-model-invocation: true` | Yes         | No            | description NOT in context; body on user invoke |
| `user-invocable: false`          | No          | Yes           | description always in context; body on invoke   |

- Side-effect/timing-sensitive actions (`/deploy`, `/commit`, `/send-slack-message`) → `disable-model-invocation: true`. If Claude tries to invoke such a skill anyway, Claude Code blocks the call and instructs it not to reproduce the steps another way, so expect Claude to suggest the user run `/name`.
- Background knowledge (e.g. `legacy-system-context`) → `user-invocable: false`.

## Skill content lifecycle

- Invoked SKILL.md enters as one message and persists for the session; Claude does NOT re-read the file on later turns → write standing instructions, not one-time steps. Persistence covers the instructions only, not permissions — an `allowed-tools` grant clears on the next user message.
- Re-invoking a skill whose rendered content is identical to what's already in context → Claude Code notes it's already loaded, no duplicate copy added. Content differs (args changed, or a dynamic-context command produced new output) → full content appended again. Pre-v2.1.202: every re-invocation appended a full duplicate copy regardless.
- Auto-compaction: re-attaches most recent invocation of each skill, keeping first **5,000 tokens** each; combined re-attach budget **25,000 tokens**, filled newest-first → older skills may drop. If behavior fades post-compaction, re-invoke the skill; put the most important instructions near the top of `SKILL.md`, since only the start survives.
- If a skill "stops working", content is usually still present; strengthen `description`/instructions or enforce via hooks. A rule that must hold every time → hook (a hook runs on every occurrence of its event); define it in the skill's `hooks` frontmatter to keep it with the skill (applies from invocation until the session ends). Judgment guidance → word it for the whole task ("Run the tests after every edit"), not a one-time step.

## Dynamic context injection (CLI feature)

- Inline `` !`<command>` `` runs the shell command BEFORE Claude sees content; output replaces the placeholder (preprocessing, not a Claude action).
  - Recognized only at line start or after whitespace; `KEY=!`cmd`` is literal.
  - Single pass; injected output is not re-scanned for further placeholders.
- Multi-line: fenced ` ```! ` block.
- Disable via `disableSkillShellExecution: true` — a normal setting, most useful in managed settings where users cannot override it. Applies to skills and custom commands from user/project/plugin/additional-directory sources; each `!` block becomes `[shell command execution disabled by policy]`. Bundled/managed skills unaffected.
- Include `ultrathink` anywhere in the skill content to request deeper reasoning when the skill runs.
- **Which tool runs it:** picked from the skill's `shell` field + environment. `shell: powershell` + PowerShell tool enabled → PowerShell tool. `shell: bash` when bash is unavailable (Windows w/o Git Bash) → the invocation fails outright (``Skill <name> requires bash (`shell: bash` in frontmatter) but Git Bash was not found``). Any other combination → Bash tool when available, else PowerShell tool.
- **Execution semantics** mirror the underlying tool: working dir = the session shell's cwd (moves with `cd`; use `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PROJECT_DIR}` for paths that must resolve consistently); default `bash` merges stderr into stdout; each command runs under the Bash tool's default 2-min timeout (an auto-backgrounded command still renders — injected text reports the move + the output file; a command that's never auto-backgrounded is killed at timeout, which aborts the invocation); output past the inline ceiling arrives as a file path + short preview, not truncated text.
- **A failed command aborts the whole invocation** (not just its placeholder) — Claude never sees that turn's skill content; shown as `Shell command failed for pattern "..."` with `[stderr]`. Default `bash`: any non-zero exit fails, EXCEPT exit code 1 from search/comparison commands (grep, diff, etc.), treated as a normal result — exit ≥2 fails even for those; append `|| true` to a command expected to exit non-zero for another reason. `shell: powershell` uses a different carveout set (includes `grep`/`git diff`, not `find`/`diff`).
- **Permission checks never prompt** for injected commands — anything but an allow decision (including a rule that would normally ask) aborts the invocation (`Shell command permission check failed for pattern "..."`). Pre-approve via `allowed-tools` to avoid the abort; a matching ask/deny rule still aborts regardless. **Auto mode exception:** a command that would otherwise need approval does NOT abort — the skill loads with an instruction telling Claude to run the command first, and Claude's own call then goes through auto mode's normal classifier checks. The abort still applies in a forked skill that sets `agent`, and in any session lacking the shell tool that runs injected commands.

### Substitutions

- `$ARGUMENTS` (full string; appended as `ARGUMENTS: …` if absent), `$ARGUMENTS[N]` / `$N` (0-based, shell-quoted), `$name` (from `arguments`).
- Unmatched placeholders: an indexed `$N` with no argument stays in the content verbatim; a named `$name` with no argument expands to an empty string.
- `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}` (`low|medium|high|xhigh|max`; ultracode reports `xhigh`), `${CLAUDE_SKILL_DIR}` (skill's own dir — for a plugin skill the skill's subdir, not the plugin root; use for bundled script paths so they resolve at any scope).
- `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` resolve in both the skill body and `allowed-tools` Bash rules (e.g. `Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)`), so a skill can run a bundled script without a prompt. `${CLAUDE_SKILL_DIR}` in `allowed-tools` requires v2.1.129+ (earlier: rule stays a literal string and never matches). `${CLAUDE_PROJECT_DIR}` (project root; same value hooks/MCP servers receive as `CLAUDE_PROJECT_DIR`) requires v2.1.196+.
- Plugin skills only: `${CLAUDE_PLUGIN_ROOT}` (plugin installation dir; use for files shared across the plugin's skills) and `${CLAUDE_PLUGIN_DATA}` (plugin's persistent data dir; survives updates). Both resolve in the skill body and in `allowed-tools` Bash rules, same as `${CLAUDE_SKILL_DIR}`.
- Escape literal `$1.00` as `\$1.00` (single backslash directly before the token). A doubled backslash (`\\$1`) does NOT escape — both backslashes remain and `$1` still expands. A backslash does NOT prevent substitution of `${CLAUDE_*}` variables. A backslash before any other `$` is left unchanged.
- Indexed args use shell-style quoting: `/my-skill "hello world" second` → `$0` = `hello world`, `$1` = `second`; `$ARGUMENTS` is always the full string as typed. An argument value that itself contains `$1`/`$ARGUMENTS` is inserted as literal text, not re-expanded (`${CLAUDE_*}` variables are still replaced after insertion).
- **Stacking:** typing several skills at the start of one message (e.g. `/code-review /fix-issue 123`) expands the first skill plus up to 5 more, passing the trailing text as `$ARGUMENTS` to each; expansion stops at the first token that isn't an inline user-invocable skill (a forked skill, or a token that could itself be a slash command like `/loop`) — that token and everything after become `$ARGUMENTS` for every expanded skill. `/code-review` is such a forked skill from v2.1.218 (pre-v2.1.218 it ran inline and stacked). Requires v2.1.199+ (pre-v2.1.199: only the first skill loads; the rest is literal argument text).

## context: fork (run in a subagent)

- Skill body becomes the subagent's task prompt; no access to conversation history; only a summary returns. `context: fork` is NOT a fork of the current conversation — when the task depends on prior discussion, fork the conversation (subagent feature) instead.
- Only meaningful for skills with an explicit task. Pure guideline skills under fork → no actionable prompt → empty result.
- With `agent: Explore`/`Plan`, CLAUDE.md + git status are skipped (small context); `general-purpose`/custom load CLAUDE.md.
- v2.1.218+: the fork runs in the **background** by default — the session keeps working and the result arrives when it finishes. `background: false` → wait for it in the invoking turn. Pre-v2.1.218: forked skills always blocked the turn.
- Claude Code waits for the result regardless of `background` when: non-interactive (`-p` flag or Agent SDK); `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`; an earlier invocation of the same skill is still running; a scheduled task fires with the skill as its prompt.
- v2.1.218+: a backgrounded fork gets the narrower background-subagent tool set (the exemption for subagents that fork the conversation does not cover it) — if a step needs a tool outside that set, use `background: false`.
- Edits by a backgrounded fork land outside session checkpoints → `/rewind` won't undo them; revert with git.
- Inverse direction = subagent `skills:` field (preloads full skill content into a subagent at startup).

## Where skills live / precedence

| Scope      | Path                               | Applies to           |
| ---------- | ---------------------------------- | -------------------- |
| Enterprise | managed settings dir               | whole org            |
| Personal   | `~/.claude/skills/<name>/SKILL.md` | all your projects    |
| Project    | `.claude/skills/<name>/SKILL.md`   | this project         |
| Plugin     | `<plugin>/skills/<name>/SKILL.md`  | where plugin enabled |

- Precedence on name clash: enterprise > personal > project. Plugin skills are `plugin:skill` namespaced (no clash). Skill beats same-named command. A skill overrides a same-named bundled skill but NOT its aliases (e.g., a `code-review` project skill replaces `/code-review` but the bundled alias `/review` still runs the bundled skill).
- Project skills load from `.claude/skills/` in cwd and every parent up to repo root; nested package skills (`packages/x/.claude/skills/`) load on demand (monorepo support). v2.1.246+: `/cd` (move the session to another directory) adds that directory's project skills too.
- Linked git worktree: parent-directory search stops at the worktree root. v2.1.277+: when the worktree checkout has no `.claude/skills` directory at its root, Claude Code loads the main checkout's project skills instead.
- Nested skill name clash (e.g. root `deploy` + `apps/web/.claude/skills/deploy/`): both stay available; the nested one gets a directory-qualified name (`apps/web:deploy`) whose description names its directory; Claude picks the variant matching the files it's working on. v2.1.203+: invoking the unqualified name still loads the root skill, but Claude Code appends the list of directory-qualified variants plus an instruction to also invoke any variant whose directory holds the files in play — so the nested variant still applies without typing the qualified name.
- A nested `.claude/skills/` below the session's start directory doesn't load at startup — it loads the first time Claude reads/edits a file in that subdirectory (until then: absent from the `/` menu, not invocable by name). v2.1.257+: `/add-dir <subdir>` forces it to load sooner.
- An enterprise/personal/project `<skill-name>` entry may be a symlink to a directory elsewhere on disk; Claude Code follows it and reads `SKILL.md` from the target, loading the skill once even if the same target is reachable from more than one location. Plugin skills handle symlinks differently.
- A skill folder with a `.claude-plugin/plugin.json` loads as a plugin named `<name>@skills-dir` (can bundle agents/hooks/MCP). In a project `.claude/skills/`, requires accepting the workspace trust dialog first.
- `--add-dir`/`/add-dir` (and SDK `additionalDirectories`/`add_dirs`, forwarded to Claude Code as `--add-dir`): `.claude/skills/`, `.claude/commands/`, and `.claude/agents/` ARE loaded (exception); only `.claude/skills/` is watched — edits to the added dir's `.claude/commands/` or `.claude/agents/` need a restart. `permissions.additionalDirectories` setting (same name as the SDK option, different effect) does NOT load skills, commands, or agents — file access only. Output styles and other config are not loaded from added dirs. `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` enables CLAUDE.md loading from added dirs (off by default).
- Loading skills/commands/subagents from an added dir requires the `project` setting source enabled (default; if `--setting-sources`/`settingSources`/`setting_sources` is set explicitly, include `project`). `--safe-mode` loads none of the three. `strictPluginOnlyCustomization` managed policy vs bare mode diverge per artifact: policy's `skills` entry off → skills AND commands both turn off, bare mode still loads skills but skips commands; policy's `agents` entry off → subagents off (independent of the `skills` entry), bare mode skips every `.claude/agents/` folder including the project's own root one.
- Cowork sessions and cloud sessions (incl. routines) do NOT read `~/.claude/skills/` on the user's machine: they load the skills enabled for the claude.ai account, synced at session start; cloud sessions additionally load project skills committed to the cloned repo's `.claude/skills/`. A personal-only skill therefore reports not-found when a routine invokes it → enable it for the claude.ai account, or commit it to the repo / ship it in a plugin declared in the repo's `.claude/settings.json` (plugins enabled only in user settings do NOT transfer to cloud sessions). Desktop scheduled tasks run locally and load skills like any local session.
- Live change detection: edits to watched `SKILL.md` apply mid-session, except in bare mode (watches nothing); a top-level skills dir created after the session started isn't watched → run `/reload-skills` to load it, and again after each later change there. Live detection covers `SKILL.md` text only. Plugin-folder `hooks/`/`.mcp.json`/`agents/`/`output-styles/` changes need `/reload-plugins`.
- Remove a skill by source: personal/project → delete its directory (drops from `/skills` in the current session; already-loaded content follows the content lifecycle); enterprise → admin deletes it from `.claude/skills/` in the managed settings dir; plugin → disable/uninstall the plugin (`/plugin uninstall <plugin-name>@<marketplace-name>`); synced → turn it off on claude.ai (deleting `~/.claude/skills/synced/<name>` by hand just re-downloads it at the next sync while it stays enabled); bundled → `disableBundledSkills: true` or `skillOverrides` `"off"`.
- Stop Claude invoking a personal/project skill without editing the file → `skillOverrides` `"user-invocable-only"`.
- Project skills committed to a repo also load when that repo is used in a Claude Tag channel.

### Synced skills (claude.ai)

- v2.1.273+: a terminal session signed in with a claude.ai account (via `/login`, not an API key/`ANTHROPIC_AUTH_TOKEN`/`CLAUDE_CODE_OAUTH_TOKEN`/`apiKeyHelper`) auto-syncs — downloads the account's skills into `~/.claude/skills/synced/` in the background at session start, then polls claude.ai roughly every 10 minutes and adds/updates/removes skills in the running session with no restart needed. Sign in mid-session via `/login` → restart to start syncing. Doesn't sync in: bare mode / `--safe-mode`; a session that skips feature-flag fetching (e.g. Bedrock, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`); a `strictPluginOnlyCustomization` policy locking skills to plugin sources; or a `--setting-sources` list omitting `user`.
- Sync never delays startup — Claude waits for a skill's download only when it invokes that skill, so a short non-interactive run can finish before a newly added skill finishes downloading. `CLAUDE_CODE_SYNC_SKILLS=1` makes a non-interactive (`-p`) run download and wait for the skill list before answering its prompt; `CLAUDE_CODE_SYNC_SKILLS_WAIT_TIMEOUT_MS` bounds how long it waits. Skills an earlier session synced stay on disk and reload in later sessions signed in to the same account, even offline.
- `syncClaudeAiSkills: false` (user settings) stops syncing on a machine — already-synced skills move to `~/.claude/skills/.trash/` and stop loading; same key in managed settings stops it org-wide while leaving Skills on elsewhere. `pdf`/`xlsx` always sync; other account skills sync per their claude.ai on/off toggle. `/skills` labels synced skills `claude.ai sync`. If the org turns Skills off on claude.ai, Claude Code removes the downloaded skills (moved to `~/.claude/skills/.trash/`, recoverable until the retention sweep deletes them) and they stop loading.
- Sync is download-only: edits to files under `~/.claude/skills/synced/` aren't saved to the claude.ai account, and a later sync can overwrite or remove them — change a synced skill on claude.ai.
- `synced` is a reserved folder name (any capitalization) at every skills location — Claude Code skips a skill you author there. v2.1.227+ (pre-v2.1.227: a `synced` folder loaded as an ordinary skill).
- Invoke by full name `/anthropic-skills:<name>` or short name `/<name>`. v2.1.269+: both forms work (short name only when nothing else claims it). Pre-v2.1.269: a synced skill had only the short name — no `/anthropic-skills:<name>` fallback existed yet. v2.1.281+: the `/` menu, `/skills`, and `/context` list a synced skill under its short name, or its full name while another command uses the short name, and `/skills` adds a note under the list for each synced skill that lost its short name (naming the personal skill/command file to rename or delete when one of yours holds the name); v2.1.269–v2.1.280: every synced skill listed under its full name, no note.
- `anthropic-skills` (and every `anthropic-skills:<x>` name) is reserved for synced skills in every session, signed in or not: a skill folder, frontmatter `name`, `.claude/commands/` file or subfolder, or saved workflow with that name doesn't load (a startup notice names the first item to rename); a plugin named `anthropic-skills` still loads (on a name clash `/anthropic-skills:<name>` runs the synced skill); an MCP server named `anthropic-skills` connects and its tools work, but its prompts don't appear as commands.
- Name clash with any other command (built-in, bundled skill, local-level skill, plugin skill, `.claude/commands/` file, MCP prompt) → the synced skill is skipped and the other command runs, even a built-in/bundled name that's currently unavailable (e.g. bundled skills disabled); the synced skill still runs via its full name `/anthropic-skills:<name>`. Name comparison ignores case/spacing/invisible chars and normalizes compatibility forms (fullwidth letters, dash variants); a look-alike letter from another alphabet counts as a different name. `/skills` and `/context` label synced skills `claude.ai sync`. (Name-comparison checks + labels require v2.1.228+.)
- Frontmatter is honored normally (an `allowed-tools` grant goes through the normal permission flow, and doesn't apply when `allowManagedPermissionRulesOnly` is set), but display text (e.g. `description`) is sanitized: control characters stripped, angle brackets escaped so it can't imitate internal formatting. Requires v2.1.228+.
- Body handling varies by session: cloud session → behaves like a local skill (isolated container). Cowork desktop session → behaves like a local skill except every `!` command line is replaced by the `disableSkillShellExecution` placeholder. Any other local session → `!` commands don't run (reach Claude as literal text, or that placeholder if the setting is on), `@` file references aren't attached, and `${CLAUDE_PROJECT_DIR}`/`${CLAUDE_SESSION_ID}` aren't substituted (literal text). Requires v2.1.228+.

## Permissions / access control

- `allowed-tools` grants no-prompt use for the invoking turn only — the grant clears on the next user message and re-invoking re-applies it; for a session-wide grant add allow rules to permission settings instead. Workspace trust does NOT gate this field: a project skill's `allowed-tools` applies whenever the skill is invoked, including in `-p` runs in folders never explicitly trusted. Review project skills before trusting a repo (a skill can self-grant broad access).
- v2.1.282+: when managed settings set `allowManagedPermissionRulesOnly`, Claude Code ignores `allowed-tools` in project and personal skills and in the other sources that setting's entry lists; the listed tools then go through the org's managed rules and the normal permission prompt. `/status` lists each skill whose `allowed-tools` was ignored so far in the session. An injected `!` command that no managed rule allows aborts the invocation (see Dynamic context injection).
- Control which skills Claude may invoke:
  - Deny `Skill` tool entirely; or allow/deny specific: `Skill(commit)`, `Skill(review-pr *)`, `Skill(deploy *)` (exact vs prefix).
  - A deny rule reaches through an alias or unqualified name: `Skill(review)` blocks the bundled `/code-review` via its `/review` alias; `Skill(deploy)` blocks a nested `apps/web:deploy` skill via its unqualified name (v2.1.260+; earlier, an unqualified deny rule didn't reach a qualified nested skill). An allow rule matches only the skill's own name and the name in Claude's invocation — no alias/unqualified reach.
  - Deny-rule reach by rule form: `Skill(anthropic-skills:deploy)` (synced skill) also blocks it when Claude Desktop delivers it to a session as a plugin; `Skill(deploy:deploy)` (plugin form of a synced skill) blocks the synced skill; `Skill(skill:deploy)` (parameter form) blocks the skill under whichever of its names Claude calls it by, incl. alias and display name.
  - Approve a synced skill without a prompt by naming it inside the reserved namespace: `Skill(anthropic-skills:pdf)` (one skill), `Skill(anthropic-skills *)` (every synced skill); `Skill(anthropic *)` does NOT cover `anthropic-skills:pdf` (a prefix outside the namespace doesn't match names inside it).
  - A few built-in commands are also reachable via the `Skill` tool: `/init`, `/security-review`. Others (e.g. `/compact`) are not.
  - `disable-model-invocation: true` removes a skill from Claude's context entirely (`user-invocable` only affects menu visibility).
- `skillOverrides` (settings; `/skills` menu writes it — highlight a skill, `Space` cycles states, `Esc` saves to `.claude/settings.local.json`): per-skill `"on" | "name-only" | "user-invocable-only"` (labeled `user-only` in the menu) `| "off"`; absent = `"on"`. v2.1.199+: `"off"` also hides the skill from Remote Control and Agent SDK command listings, not just the terminal `/` menu; invoking a hidden skill by its full name still errors instead of running. Plugin skills managed via `/plugin`, not this.
- An entry keyed by a bundled skill's alias (e.g. `checkup` for `/doctor`) in managed settings or a `--settings` file applies to the underlying skill — v2.1.260+, restrict-only (can't make it more visible than an entry under the real name), and an entry under the real name in managed settings wins if both are set; before v2.1.260 alias entries had no effect anywhere. In user/project/local settings, entries match skill names only (an entry named `review` doesn't reach `/code-review` via its `/review` alias).

## Evaluation & iterative development

- **Build evals first.** 1) run task without skill, log failures; 2) create ≥3 scenarios; 3) baseline; 4) write minimal instructions to pass; 5) iterate vs baseline. (No built-in runner; eval JSON = `skills`, `query`, `files`, `expected_behavior`.)
- **Eval automation:** the `skill-creator` plugin (`/plugin install skill-creator@claude-plugins-official`) automates the baseline-comparison loop — stores cases in `evals/evals.json`, spawns a subagent per case, writes `grading.json` + `benchmark.json` (with-skill vs without), runs blind A/B version comparison, tunes `description`/`when_to_use` by measuring should-trigger/should-not-trigger hit rates, and opens an HTML review viewer for qualitative feedback. It is a plugin, not a built-in runner.
- **For a plugin-shipped skill**, `claude plugin eval` is the built-in alternative: runs each prompt in an isolated session with and without the plugin, scores against graders you write (or it generates), and exits non-zero below a threshold — gate CI on it. Its eval format is separate from skill-creator's `evals/evals.json` and the two aren't interchangeable. A `tool_used: Skill` grader measures trigger rate directly — rerun after each `description` edit to confirm it still fires on the right prompts.
- **Claude A / Claude B loop:** Claude A authors/refines; fresh Claude B uses it on real tasks; observe B's behavior; bring specifics back to A. Claude understands the skill format natively — no special "writing-skills" skill needed.
- Observe: unexpected exploration paths, missed reference links, over-relied sections (→ inline them), ignored files (→ remove or signal better). `name`+`description` are the most critical levers.
- Team feedback: share the skill with teammates, observe usage (does it activate when expected? are instructions clear? what's missing?), fold gaps back in.

## Anti-patterns

- Windows paths — use forward slashes everywhere (`scripts/x.py`).
- Too many options — give one default + escape hatch ("Use pdfplumber; for scanned PDFs use pdf2image + pytesseract"), not a menu of 5 libs.
- Time-sensitive instructions; inconsistent terminology; deeply nested refs; assuming installed packages; narrating reasoning instead of stating actions.
- Malformed frontmatter YAML — the skill body still loads but with empty metadata (no `description` to match against), so `/name` still works but Claude won't auto-invoke it. Run with `--debug` to see the parse error. v2.1.233+: `claude plugin validate <dir>` (e.g. `.claude/skills`) surfaces every SKILL.md in a directory whose frontmatter fails to parse.
- Personal skill folders "disappeared" from `~/.claude/skills/` → look in `~/.claude/skills/.trash/` (synced skills download into the separate `synced` subfolder; folders you create are never moved or deleted by sync). Pre-v2.1.280: a `manifest.json` in `~/.claude/skills/` made Claude Code move the skill folders it listed into a timestamped `.trash/` folder, and they stopped loading. Restore by moving the folder back before the retention sweep deletes trash entries (default 30 days after the move).

## Pre-ship checklist

- [ ] `description` specific, third person, what + when, key use case first
- [ ] Body <500 lines; extra detail in separate files; refs one level deep; TOC if >100 lines
- [ ] No time-sensitive info; consistent terminology; concrete examples
- [ ] Scripts: handle errors, no voodoo constants, dependencies listed+verified, clearly documented, forward slashes, validation/feedback loops for critical ops
- [ ] MCP tools fully qualified (`Server:tool`)
- [ ] Invocation control set intentionally (`disable-model-invocation` / `user-invocable`)
- [ ] ≥3 evals; tested on Haiku/Sonnet/Opus + real usage; team feedback incorporated (if applicable)

## Version / surface notes

- Commands merged into skills; `.claude/commands/*.md` still work with same frontmatter.
- Bundled skills ship in every session (prompt-based, invoked like any skill): `/doctor`, `/code-review`, `/batch`, `/debug`, `/loop`, `/claude-api`, plus `/run`, `/verify`, `/run-skill-generator`. A few need a specific feature enabled to appear at all — e.g. `/workflow-authoring` only when dynamic workflows are on. Disable the whole set via `disableBundledSkills` setting. A same-named user/project/plugin skill overrides a bundled one.
- v2.1.215+: `/verify` and `/code-review` run only on user invocation (Claude no longer triggers them itself); other bundled skills stay model-invocable. Pre-v2.1.215: Claude could run both on its own.
- v2.1.205+: `/doctor` is the one exception to `disableBundledSkills` — stays typable when the setting is on. Hide it via `DISABLE_DOCTOR_COMMAND` env var or `skillOverrides: {"doctor": "off"}`. Before v2.1.205, `/doctor` was a built-in command, not a bundled skill.
- v2.1.286+: when a session starts with a skill named `verify` or `simplify` in place, Claude Code's commit instructions tell Claude to run it right before each commit (except docs/test-only changes). Conditions at session start: the skill loads from an enterprise, personal, project, or additional-directory location, or from a `.claude/commands/` file with that name (the recipe `/verify` records at the repo root counts; the bundled `/verify` and `/simplify`, plugin skills, and claude.ai account skills don't); Claude can invoke it (no `disable-model-invocation: true`); `includeGitInstructions` isn't turned off (turning it off removes this instruction with the rest of the built-in commit and PR instructions).
- `/claude-api` (bundled) loads Claude API + Managed Agents reference for the project's language; auto-activates when code imports `anthropic` or `@anthropic-ai/sdk`. Subcommands (`/claude-api <subcommand>`): `migrate` (update API code to a newer model) and `managed-agents-onboard` predate v2.1.221; `prompt-audit` v2.1.221+; `upgrade` (Anthropic SDK dependency across a major version, currently Python `anthropic` 0.x → 1.x) v2.1.236+; `cost-optimize` v2.1.247+; `build-eval` and `hillclimb` v2.1.259+; `preserved-thinking-migration` v2.1.282+.
- `/run`, `/verify`, `/run-skill-generator` require Claude Code ≥ v2.1.145. `/run`/`/verify` infer the app launch from project type + README/`package.json`/Makefile — unreliable beyond a standard launch (DB, env file, GUI session, multi-step build). `/run-skill-generator` records a working recipe once as a per-project skill at `.claude/skills/run-<name>/`, which `/run`/`/verify`/other agents then follow. `/verify` can also self-record: with no recipe, it writes what worked to `.claude/skills/verify/SKILL.md` (repo root, or the touched package dir in a monorepo) — requires v2.1.200+; at the repo root the recorded skill replaces the bundled `/verify`. v2.1.205+: it edits that file only when a run was steered wrong (failed command / missing step), so it stays diff-free between sessions otherwise; pre-v2.1.205 it folded in everything a run learned, causing frequent merge conflicts.
- `allowed-tools` applies in both CLI and SDK sessions for project/personal skills (see SDK discovery note above); synced skills follow their own frontmatter rules. Use skills only from trusted sources; a malicious skill can direct tool/code execution — audit every bundled file (SKILL.md, scripts, images, resources) for unexpected network calls or file access; skills that fetch external URLs are a particular risk. Claude Enterprise orgs can turn on skill content scanning for custom skills uploaded in claude.ai and Cowork (not Skills API or Console uploads). Skills feature is not ZDR-eligible.
- Sharing scope by surface: claude.ai custom skills are per-user (zip upload via Settings > Features; no admin/org-wide distribution); Claude API skills are workspace-wide; skills uploaded to claude.ai and via the API are not available on the other. Claude Code skills: personal, project, plugin, or managed.
