# Claude Code Commands — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose. Sources: Anthropic official docs
> (commands reference + skills/slash-commands authoring), verified: 2026-06-21.
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
- A skill folder with a `.claude-plugin/plugin.json` loads as a skills-directory plugin named `<name>@skills-dir` — it can then bundle `agents/`, `hooks/`, and MCP servers. In a project's `.claude/skills/`, this requires accepting the workspace trust dialog first.
- `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` env var loads `CLAUDE.md` from `--add-dir` directories (not loaded by default).

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
| `$ARGUMENTS` | All arguments passed at invocation, as the full string typed. If absent from content, arguments are appended as `ARGUMENTS: <value>`. |
| `$ARGUMENTS[N]` | Specific argument by 0-based index. Example: `$ARGUMENTS[0]` = first arg. |
| `$N` | Shorthand for `$ARGUMENTS[N]`. Example: `$0` = first arg, `$1` = second arg. |
| `$name` | Named argument defined via the `arguments` frontmatter field. Name maps to a position by declaration order. |
| `${CLAUDE_SESSION_ID}` | Current session ID. For logging, session-specific files, correlating output with sessions. |
| `${CLAUDE_EFFORT}` | Current effort level: `low`, `medium`, `high`, `xhigh`, `max`. Ultracode reports as `xhigh` (not a distinct level). |
| `${CLAUDE_SKILL_DIR}` | Directory containing the skill's `SKILL.md`. For plugin skills, the skill's subdir within the plugin (NOT plugin root). Use in `!` bash injection to reference bundled scripts regardless of cwd. |

- Indexed args use shell-style quoting: wrap multi-word values in quotes to pass as one arg. `/my-skill "hello world" second` → `$0`=`hello world`, `$1`=`second`. `$ARGUMENTS` always expands to the full string as typed.
- Escape a literal `$` before a digit / `ARGUMENTS` / declared arg name with one backslash: `\$1.00`. A backslash before any other `$` is left unchanged. Only a single backslash directly before the token escapes; `\\$1` leaves both backslashes and still expands `$1`.

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

## Invocation control & permissions

### Who invokes (frontmatter)
| Frontmatter | You invoke | Claude auto-invoke | When loaded into context |
|---|---|---|---|
| (default) | Yes | Yes | Description always in context; full skill loads when invoked |
| `disable-model-invocation: true` | Yes | No | Description NOT in context; full skill loads when you invoke |
| `user-invocable: false` | No | Yes | Description always in context; full skill loads when invoked |

- `user-invocable: false` controls `/` menu visibility only — NOT Skill tool access. Use `disable-model-invocation: true` to block programmatic (Claude/subagent) invocation.

### Skill(...) permission rules
- Deny the bare `Skill` tool in `/permissions` to disable all skills.
- `Skill(name)` — exact-match allow/deny. `Skill(name *)` — prefix match with any arguments.
- Permission settings still govern baseline approval; `allowed-tools` does not restrict, only pre-approves.

### skillOverrides setting
Controls skill visibility from `settings` instead of the skill's own frontmatter (for skills you don't want to edit). `/skills` menu writes it to `.claude/settings.local.json` (Space cycles states, Enter saves). Each key = skill name; value is one of:

| Value | Listed to Claude | In `/` menu |
|---|---|---|
| `"on"` | Name + description | Yes |
| `"name-only"` | Name only | Yes |
| `"user-invocable-only"` | Hidden | Yes |
| `"off"` | Hidden | Hidden |

Absent from `skillOverrides` = treated as `"on"`. Plugin skills are NOT affected by `skillOverrides` — manage via `/plugin`.

## Skill content lifecycle & compaction

- An invoked skill's rendered `SKILL.md` enters the conversation as a single message and stays for the rest of the session. Claude Code does NOT re-read the file on later turns — write standing instructions, not one-time steps.
- Auto-compaction carries invoked skills forward within a token budget: after summary, re-attaches the most recent invocation of each skill, keeping the first **5,000 tokens** of each. Re-attached skills share a combined **25,000-token** budget, filled most-recently-invoked first — older skills can be dropped entirely if many were invoked in one session.
- If a large skill or many later skills push it out, re-invoke after compaction to restore full content.
- In a regular session, skill descriptions load into context but full content loads only on invoke. Subagents with preloaded skills differ: full content is injected at startup; `disable-model-invocation: true` blocks that preload.

### Live change detection
- Adding/editing/removing a skill under a *watched* dir (`~/.claude/skills/`, project `.claude/skills/`, or a `.claude/skills/` inside an `--add-dir` dir) takes effect mid-session without restart. Live detection covers `SKILL.md` **text** only.
- Creating a top-level skills dir that did NOT exist at session start requires restarting Claude Code so it can be watched.
- For a skill folder that is also a plugin, changes to `hooks/`, `.mcp.json`, `agents/`, and `output-styles/` need `/reload-plugins` to take effect (not live).

## Evaluating a skill (skill-creator)

- A skill triggering only proves Claude found it — measure invocation rate AND output quality separately. Method: baseline comparison — run realistic prompts in fresh sessions with the skill available vs disabled (`skillOverrides: off`), compare.
- The `skill-creator` plugin (`/plugin install skill-creator@claude-plugins-official`, then `/reload-plugins`) automates the loop. Ask e.g. `evaluate my <name> skill with skill-creator`. It produces, inside the skill dir:

| Artifact | Contents |
|---|---|
| `evals/evals.json` | Test cases: prompts, input files, expected behavior |
| `grading.json` | Per-assertion pass/fail with evidence (one subagent per case, clean context) |
| `benchmark.json` | Aggregated pass rate / time / tokens, with-skill vs without |

- Also: blind A/B between two skill versions; description tuning via should-trigger / should-not-trigger prompts; HTML review viewer for qualitative feedback.

## Built-in commands (overview)

The following built-in commands are shipped with Claude Code. Entries marked **[Skill]** are bundled skills (prompt-based; Claude can also auto-invoke). Entries marked **[Workflow]** are bundled dynamic workflows (fan out across subagents, run in the background). Others are CLI-coded behaviors. Bundled skills are gated by the `disableBundledSkills` setting. Note: a few CLI-coded built-ins (`/init`, `/review`, `/security-review`) are ALSO callable via the `Skill` tool — that is distinct from being a bundled skill (see closing note).

| Command | Summary |
|---|---|
| `/add-dir <path>` | Grant file access to an extra directory without moving the session |
| `/advisor [model\|off]` | Enable/disable the advisor tool (consults a second model). Accepts `opus`, `sonnet`, `fable`, or a model ID |
| `/agents` | Open the subagent manager |
| `/autofix-pr [prompt]` | Spawn a Claude Code on the web session that watches the current branch's PR and pushes fixes when CI fails or reviewers comment. Detects the open PR via `gh pr view`; pass a prompt to scope it (e.g. `only fix lint and type errors`). Requires `gh` + web access |
| `/background [prompt]` | Detach session to run as a background agent. Alias: `/bg` |
| `/batch <instruction>` | **[Skill]** Decompose a large change into 5-30 independent units, run each in its own worktree subagent + PR |
| `/branch [name]` | Fork the current conversation to a new branch (switch into the copy; original kept in `/resume`) |
| `/btw <question>` | Ask a quick side question without adding to conversation history |
| `/cd <path>` | Move session to a new working directory (preserves prompt cache; new dir's `CLAUDE.md` appended as a message). Session relocated to new dir's project storage; prompts to trust an unfamiliar dir. Restrict/disable targets via `Cd` permission rules |
| `/claude-api [migrate\|managed-agents-onboard]` | **[Skill]** Load Claude API reference for the project language; `migrate` upgrades code to a newer model |
| `/clear [name]` | Start new conversation; previous stays in `/resume`. Aliases: `/reset`, `/new` |
| `/code-review [low\|medium\|high\|xhigh\|max\|ultra] [--fix] [--comment] [target]` | **[Skill]** Review diff for correctness bugs + reuse/simplification/efficiency cleanups; `--fix` applies findings; `--comment` posts inline GitHub PR comments; `ultra` runs multi-agent cloud review |
| `/compact [instructions]` | Summarize conversation to free context while continuing the same task |
| `/config [key=value ...]` | View/edit configuration; `key=value` form sets a setting directly (also in `-p` mode). Alias: `/settings` |
| `/context [all]` | Show context window usage as a colored grid with optimization suggestions; in fullscreen the per-item breakdown collapses — pass `all` to expand it |
| `/debug [description]` | **[Skill]** Enable debug logging mid-session and troubleshoot from the session debug log |
| `/diff` | Show what changed in the current working tree |
| `/doctor` | Diagnose install issues and skill/config problems (reports description budget overflow) |
| `/effort [level\|auto]` | Adjust reasoning effort level (`low`/`medium`/`high`/`xhigh`/`max`/`ultracode`); `max` and `ultracode` are session-only. `ultracode` = `xhigh` reasoning + automatic workflow orchestration. `auto` resets to model default. Takes effect immediately |
| `/exit` | Exit the CLI. In an attached background session this detaches and the session keeps running. Alias: `/quit` |
| `/feedback [report]` | Submit feedback or report a bug. Aliases: `/bug`, `/share` |
| `/fewer-permission-prompts` | **[Skill]** Scan transcripts for common read-only Bash/MCP calls, add a prioritized allowlist to project settings |
| `/focus` | Toggle focus view (last prompt + tool summary + final response only) |
| `/fork <directive>` | Spawn a forked background subagent that inherits the full conversation; result returns when done |
| `/goal [condition\|clear]` | Set a goal; Claude works across turns until condition is met. No arg shows the current/last goal. Remove an active goal early with `clear`, `stop`, `off`, `reset`, `none`, or `cancel` |
| `/help` | Show available commands |
| `/hooks` | View/manage hooks |
| `/init` | Generate a starter `CLAUDE.md` for the repo (CLI-coded; also Skill-tool callable). `CLAUDE_CODE_NEW_INIT=1` → interactive flow covering skills/hooks/personal memory |
| `/keybindings` | Open your keyboard shortcuts file |
| `/login` | Authenticate with Anthropic |
| `/logout` | Sign out |
| `/loop [interval] [prompt]` | **[Skill]** Run a prompt repeatedly while the session stays open; omit interval for self-pacing. Alias: `/proactive` |
| `/mcp [reconnect <server>\|enable\|disable [<server>\|all]]` | Manage MCP server connections and OAuth. No arg opens the interactive list; `reconnect <server>` reconnects one disconnected server; `enable`/`disable` with a server name or `all` changes connection state without the dialog |
| `/memory` | Edit project or user memory |
| `/model [name]` | View or change the active model |
| `/permissions` | View/manage tool permission rules |
| `/plan [description]` | Enter plan mode; optional description starts plan mode on that task |
| `/reload-plugins [--force]` | Reload plugin configuration (needed after changing hooks/agents/MCP in a plugin); `--force` when reload invalidates the prompt cache |
| `/reload-skills` | Re-scan skill + command dirs so on-disk additions/changes apply without restart |
| `/release-notes` | Show Claude Code release notes |
| `/remote-control` | Make this session available for remote control from claude.ai. Alias: `/rc` |
| `/resume [session]` | Return to a previous conversation (background sessions marked `bg`). Alias: `/continue` |
| `/review [PR]` | Review a PR locally (CLI-coded; also Skill-tool callable) |
| `/rewind` | Roll code and/or conversation back to a checkpoint. Aliases: `/checkpoint`, `/undo` |
| `/run` | **[Skill]** Launch and drive the project's app to see a change working |
| `/run-skill-generator` | **[Skill]** Record a per-project recipe so `/run` + `/verify` know how to build/launch the app |
| `/sandbox` | Toggle sandbox mode. Supported platforms only |
| `/schedule [description]` | Create/update/list/run routines that execute on Anthropic-managed cloud infra; Claude walks setup conversationally. Alias: `/routines` |
| `/security-review` | Security-focused review of branch diff (CLI-coded; also Skill-tool callable) |
| `/setup-bedrock` | Configure Amazon Bedrock auth/region/model pins via wizard. Only visible when `CLAUDE_CODE_USE_BEDROCK=1` |
| `/setup-vertex` | Configure Google Vertex AI auth/project/region/model pins via wizard. Only visible when `CLAUDE_CODE_USE_VERTEX=1` |
| `/simplify [target]` | **[Skill]** Cleanup-only review (reuse/simplification/efficiency/abstraction) and apply fixes; does NOT hunt bugs |
| `/skills` | List skills; `t` sorts by token count; `Space`+`Enter` writes `skillOverrides` |
| `/status` | Show session status |
| `/statusline` | Configure the status line; describe what you want, or run with no arg to auto-configure from your shell prompt |
| `/stop` | Stop the current background session (only while attached; transcript + worktree kept). To detach without stopping use `/exit` |
| `/tasks` | View/manage background work in the session. Also `/bashes` |
| `/team-onboarding` | Generate a team onboarding guide from your last-30-days Claude Code usage (sessions, commands, MCP servers) as markdown a teammate can paste; on paid claude.ai plans also returns a Claude Code share link |
| `/teleport` | Pull a web session into this terminal. Also `/tp` |
| `/terminal-setup` | Configure terminal keybindings (Shift+Enter etc.); shown only where needed |
| `/ultraplan <prompt>` | Draft a plan in an ultraplan session, review it in the browser, then execute remotely or send it back to your terminal |
| `/ultrareview [PR]` | Run a deep multi-agent code review in a cloud sandbox. Preferred invocation is now `/code-review ultra`; `/ultrareview` remains as an alias |
| `/usage` | Show session cost, plan usage limits, and activity stats; on a paid plan (Pro/Max/Team/Enterprise) includes a per-skill/subagent/plugin/MCP-server breakdown. Aliases: `/cost`, `/stats` |
| `/usage-credits` | Configure usage credits to keep working past a limit. Previously `/extra-usage` |
| `/verify` | **[Skill]** Build + run the app to confirm a change works (not just tests) |
| `/workflows` | Open the workflow progress view to watch, pause, resume, or save running/completed workflows |

Bundled workflows (run via `/`): `/deep-research <question>` **[Workflow]** — fan out web searches, cross-check sources, synthesize a cited report.

Note: a few CLI-coded built-ins (`/init`, `/review`, `/security-review`) are also callable via the `Skill` tool; this is distinct from being a bundled skill. Other built-ins (e.g. `/compact`) are not Skill-tool callable.

## Version notes

| Prefix | Note |
|---|---|
| `version <= 2.1.90:` | `/pr-comments [PR]` existed (fetch GitHub PR comments via `gh`). Removed in v2.1.91 — ask Claude directly to view PR comments. |
| `version >= 2.1.98:` | `/advisor [model\|off]` available (advisor tool). `fable` arg added in v2.1.170. |
| `version >= 2.1.145:` | `/run`, `/verify`, `/run-skill-generator` bundled skills available. |
| `version >= 2.1.152:` | `/reload-skills` available (re-scan skill/command dirs without restart). |
| `version >= 2.1.154:` | `/simplify` runs a separate cleanup-only review (no bug hunting); earlier it equaled `/code-review --fix`. |
| `version >= 2.1.161:` | `/fork <directive>` spawns a forked subagent; before this it was an alias for `/branch`. |
| `version >= 2.1.169:` | `/cd <path>` available. Earlier versions report `Unknown command: /cd`. |
| `version >= 2.1.181:` | `/config key=value` sets a setting directly (also in `-p`); named shorthand keys (e.g. `theme=dark`) added in v2.1.182. |
| `version >= current:` | Skills (`.claude/skills/<name>/SKILL.md`) are the recommended format. `.claude/commands/` is legacy but continues to be supported. |
| `version >= current:` | Plugin-root `SKILL.md` with `name:` frontmatter sets the plugin command name; without `name:`, plugin directory name is used as fallback. |
| `version >= current:` | `disableBundledSkills` setting disables all bundled skills (`/code-review`, `/batch`, `/debug`, `/loop`, `/run`, `/verify`, etc.). |
| `version >= current:` | `disableSkillShellExecution` setting disables `!` injection for user/project/plugin skills; bundled and managed skills are unaffected. |
| `version >= current:` | `skillListingBudgetFraction` (default: 0.01 = 1% of model context) and `SLASH_COMMAND_TOOL_CHAR_BUDGET` (env, fixed char count) control description budget. |
| `version >= current:` | `maxSkillDescriptionChars` caps each skill's combined `description`+`when_to_use` at 1,536 chars (configurable). |
| `version >= current:` | `skillOverrides` setting (`.claude/settings.local.json`) sets per-skill visibility: `on` / `name-only` / `user-invocable-only` / `off`. Plugin skills unaffected. |
