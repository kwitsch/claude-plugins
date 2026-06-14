# Claude Code Commands — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose. Sources: Anthropic official docs
> (commands reference + skills/slash-commands authoring), verified: 2026-06-14.
> Apply when authoring, reviewing, or invoking slash commands or custom skills/commands.

## What a slash command is / when vs a skill

- A slash command is any entry callable as `/name` from the Claude Code prompt or SDK.
- Two source formats produce slash commands:
  - **Skills** (`<dir>/SKILL.md`) — recommended. Supports bundled files, full frontmatter, autonomous + user invocation.
  - **Commands** (`<dir>/<name>.md`) — legacy flat file. Same frontmatter subset; no bundled-file support. Use skills for new work.
- If a skill and a command share the same name, the skill takes precedence.
- Built-in commands are coded into the CLI; they cannot be replaced by user files (but a few are bundled skills themselves — see Built-in commands).
- Choose a skill/command over a CLAUDE.md entry when the content is a *procedure* the user or model invokes on demand, not an always-on fact or convention.

## Locations & precedence

Skills and commands are resolved in this order (highest → lowest precedence):

| Level | Skills path | Commands path (legacy) | Scope |
|---|---|---|---|
| Enterprise (managed) | See managed settings docs | — | All org users |
| Personal | `~/.claude/skills/<name>/SKILL.md` | `~/.claude/commands/<name>.md` | All your projects |
| Project | `.claude/skills/<name>/SKILL.md` | `.claude/commands/<name>.md` | This project only |
| Plugin | `<plugin>/skills/<name>/SKILL.md` | — | Where plugin is enabled |

- Enterprise overrides personal; personal overrides project.
- Plugin skills use a `plugin-name:skill-name` namespace — cannot conflict with other levels.
- Skills also load from `.claude/skills/` in every parent directory up to repo root (monorepo support).
- Nested `.claude/skills/` under a subdirectory load on demand when Claude accesses files there.
- `--add-dir` / `/add-dir` directories: `.claude/skills/` inside them is loaded automatically (exception to the general rule that `--add-dir` is file-access only, not config discovery).
- `permissions.additionalDirectories` in `settings.json` grants file access only — does NOT load skills.

## Frontmatter reference

All fields optional; only `description` recommended. YAML between `---` markers at top of `SKILL.md` (or legacy `.md` command file).

| Field | Purpose |
|---|---|
| `name` | Display label in listings. Defaults to directory name. **Does NOT set the `/command` name** except for a plugin-root `SKILL.md` — in `skills/` subdirs the directory name drives the command. |
| `description` | What it does and when to use it. Claude uses this to decide when to apply. Falls back to first markdown paragraph if omitted. Put key use case first; combined with `when_to_use`, truncated at **1,536 chars** in the listing. |
| `when_to_use` | Extra trigger context / example phrases. Appended to `description` in listings; counts toward 1,536-char cap. |
| `argument-hint` | Autocomplete hint string, e.g. `[issue-number]` or `[filename] [format]`. |
| `arguments` | Named positional args for `$name` substitution. Space-separated string or YAML list; names map to positions in order. |
| `disable-model-invocation` | `true` → only the user can invoke (`/name`); removes description from Claude's context; blocks preload into subagents. Default: `false`. |
| `user-invocable` | `false` → hidden from `/` menu; Claude-only background knowledge. Default: `true`. |
| `allowed-tools` | Pre-approve tools (no per-use prompt) while skill is active. Space/comma string or YAML list. Does NOT restrict other tools; baseline permission settings still apply. |
| `disallowed-tools` | Remove tools from pool while skill is active. Clears on next user message. Space/comma string or YAML list. |
| `model` | Override model for the current turn while skill is active. Not saved; session model resumes on next prompt. Accepts same values as `/model`, or `inherit`. |
| `effort` | Override effort level while skill is active. Options: `low`, `medium`, `high`, `xhigh`, `max`. Available levels depend on model. |
| `context` | `fork` → run in an isolated subagent (no conversation history). |
| `agent` | Subagent type when `context: fork`. Options: `Explore`, `Plan`, `general-purpose`, or any custom agent. Default: `general-purpose`. |
| `hooks` | Hooks scoped to this skill's lifecycle. See hooks reference for configuration shape. |
| `paths` | Glob patterns; auto-activate only when matching files are in context. Comma string or YAML list. |
| `shell` | `bash` (default) or `powershell` for `!` injection. PowerShell requires `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`. |

Note: `allowed-tools` is CLI-only. In the Agent SDK, control access via `allowedTools` + `permissionMode: "dontAsk"` on `ClaudeAgentOptions`.

## Arguments ($ARGUMENTS, $1..$N, named args)

Available string substitutions in skill/command body:

| Variable | Description |
|---|---|
| `$ARGUMENTS` | All arguments passed at invocation. If absent from content, arguments are appended as `ARGUMENTS: <value>`. |
| `$ARGUMENTS[N]` | Specific argument by 0-based index. Example: `$ARGUMENTS[0]` = first arg. |
| `$N` | Shorthand for `$ARGUMENTS[N]`. Example: `$0` = first arg, `$1` = second arg. |
| `$name` | Named argument defined via the `arguments` frontmatter field. Name maps to a position by declaration order. |

Example frontmatter + usage:
```yaml
---
arguments: component source target
---
Migrate $component from $source to $target.
```
Invocation `/migrate-component SearchBar React Vue` → `$component`=`SearchBar`, `$source`=`React`, `$target`=`Vue`.

## Dynamic context (!`bash` injection, @file references)

### Inline shell injection
- Syntax: `` !`<command>` `` — runs shell command at skill load time; output replaces the placeholder before Claude sees anything.
- `!` must appear at line start or immediately after whitespace. `` KEY=!`cmd` `` is NOT expanded (left as literal text).
- Output is plain text; not re-scanned for further `` !`...` `` placeholders.
- Multi-line variant: fenced block opened with `` ```! ``:

````markdown
## Environment
```!
node --version
git status --short
```
````

- Disable repo-wide with `"disableSkillShellExecution": true` in `settings.json`. Each command replaced with `[shell command execution disabled by policy]`. Bundled and managed skills are not affected.
- Use `ultrathink` anywhere in skill content to request deeper reasoning when the skill runs.

### Supporting files (@file references)
- A skill directory can include supporting files (templates, examples, scripts, reference docs) alongside `SKILL.md`.
- Reference them from `SKILL.md` so Claude knows they exist and when to load them.
- Bundled files incur zero context cost until accessed — reference at need, not upfront.
- Supported structure example:
```
my-skill/
├── SKILL.md           # Required entry point
├── template.md        # Template for Claude to fill in
├── examples/
│   └── sample.md
└── scripts/
    └── validate.sh
```
- Legacy `.claude/commands/<name>.md` files do NOT support bundled supporting files.

## Namespacing & invocation

### Invocation forms
| Source | Command name | Example |
|---|---|---|
| `.claude/skills/<name>/SKILL.md` | `/<name>` | `/deploy-staging` |
| `~/.claude/skills/<name>/SKILL.md` | `/<name>` | `/my-util` |
| `.claude/commands/<name>.md` | `/<name>` | `/deploy` |
| Plugin `skills/<name>/SKILL.md` | `/<plugin-name>:<name>` | `/my-plugin:review` |
| Plugin root `SKILL.md` (with `name:` in frontmatter) | `/<plugin-name>:<name>` | `/my-plugin:review` |
| Plugin root `SKILL.md` (no `name:` frontmatter) | `/<plugin-name>:<plugin-dir-name>` | `/my-plugin:my-plugin` |

- Plugin namespace (`plugin-name:skill-name`) prevents conflicts with personal/project skills.
- `name` frontmatter only overrides the command name for a plugin-root `SKILL.md`; in `skills/` subdirs the directory name always drives the command.

### Subdirectory organization
- Skills in `.claude/skills/<subdir>/<name>/SKILL.md` are invoked as `/<name>` (subdirectory is not part of the command name).
- Within a plugin, `skills/<subdir>/<name>/SKILL.md` → `/<plugin>:<name>`.

### SDK: discovering available commands
At session init, the `system`/`SystemMessage` event with `subtype: "init"` carries a `slash_commands` array listing all available commands (built-in + custom):
```typescript
// TypeScript
if (message.type === "system" && message.subtype === "init") {
  console.log(message.slash_commands);
  // e.g. ["clear", "compact", "context", "usage", "refactor"]
}
```
```python
# Python
if isinstance(message, SystemMessage) and message.subtype == "init":
    print(message.data["slash_commands"])
```

## Built-in commands (overview)

The following built-in commands are shipped with Claude Code. Entries marked **[Skill]** are bundled skills (prompt-based, can also be invoked by Claude). Others are CLI-coded behaviors.

| Command | Summary |
|---|---|
| `/add-dir <path>` | Grant file access to an extra directory without moving the session |
| `/agents` | Open the subagent manager |
| `/background` | Detach session to run as a background agent |
| `/batch` | Decompose a large change into independent units, run each in its own worktree |
| `/branch [name]` | Fork the current conversation to a new branch |
| `/btw <question>` | Ask a quick side question without adding to conversation history |
| `/cd <path>` | Move session to a new working directory (preserves prompt cache) |
| `/clear [name]` | Start new conversation; previous stays in `/resume`. Aliases: `/reset`, `/new` |
| `/code-review [--fix\|ultra]` | Check diff for correctness bugs and cleanups; `--fix` applies findings; `ultra` runs multi-agent cloud review |
| `/compact` | Summarize conversation to free context while continuing the same task |
| `/config` | View/edit configuration |
| `/context` | Show context window usage breakdown |
| `/debug` | Diagnose runtime issues |
| `/diff` | Show what changed in the current working tree |
| `/doctor` | Diagnose install issues and skill/config problems (reports description budget overflow) |
| `/effort [level]` | Adjust reasoning effort level (`low`/`medium`/`high`/`xhigh`/`max`) |
| `/exit` | Exit the CLI. Alias: `/quit` |
| `/feedback [report]` | Submit feedback or report a bug. Aliases: `/bug`, `/share` |
| `/focus` | Toggle focus view (last prompt + tool summary + final response only) |
| `/goal [condition\|clear]` | Set a goal; Claude works across turns until condition is met |
| `/help` | Show available commands |
| `/hooks` | View/manage hooks |
| `/init` | **[Skill]** Generate a starter `CLAUDE.md` for the repo |
| `/login` | Authenticate with Anthropic |
| `/logout` | Sign out |
| `/mcp` | Manage MCP server connections |
| `/memory` | Edit project or user memory |
| `/model [name]` | View or change the active model |
| `/permissions` | View/manage tool permission rules |
| `/plan` | Switch to plan mode before a large change |
| `/pr-comments` | Fetch PR review comments |
| `/reload-plugins` | Reload plugin configuration (needed after changing hooks/agents/MCP in a plugin) |
| `/release-notes` | Show Claude Code release notes |
| `/remote-control` | Continue this local session from another device |
| `/resume [name]` | Return to a previous conversation |
| `/review` | **[Skill]** Deep read-only code review |
| `/rewind [N]` | Roll code and conversation back to a checkpoint |
| `/security-review` | **[Skill]** Security-focused code review |
| `/status` | Show session status |
| `/tasks` | List background tasks in the current session |
| `/teleport` | Pull a web session into this terminal |
| `/terminal` | Configure terminal settings |
| `/usage` | Show token/cost usage for the session |

Note: a few built-in commands (e.g. `/init`, `/review`, `/security-review`) are available through the `Skill` tool; others (e.g. `/compact`) are not.

## Version notes

| Prefix | Note |
|---|---|
| `version >= 2.1.169:` | `/cd <path>` available. Earlier versions report `Unknown command: /cd`. |
| `version >= current:` | Skills (`.claude/skills/<name>/SKILL.md`) are the recommended format. `.claude/commands/` is legacy but continues to be supported. |
| `version >= current:` | Plugin-root `SKILL.md` with `name:` frontmatter sets the plugin command name; without `name:`, plugin directory name is used as fallback. |
| `version >= current:` | `disableSkillShellExecution` setting disables `!` injection for user/project/plugin skills; bundled and managed skills are unaffected. |
| `version >= current:` | `skillListingBudgetFraction` (default: 0.01 = 1% of model context) and `SLASH_COMMAND_TOOL_CHAR_BUDGET` (env, fixed char count) control description budget. |
| `version >= current:` | `maxSkillDescriptionChars` caps each skill's combined `description`+`when_to_use` at 1,536 chars (configurable). |
