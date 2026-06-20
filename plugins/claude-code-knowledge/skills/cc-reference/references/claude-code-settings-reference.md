# Claude Code Settings — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose.
> Sources: https://code.claude.com/docs/en/settings.md,
>   https://code.claude.com/docs/en/env-vars.md,
>   https://code.claude.com/docs/en/permissions.md,
>   https://code.claude.com/docs/en/permission-modes.md,
>   https://code.claude.com/docs/en/model-config.md,
>   https://code.claude.com/docs/en/output-styles.md,
>   https://code.claude.com/docs/en/statusline.md,
>   https://code.claude.com/docs/en/sandboxing.md
> verified: 2026-06-20

## settings.json: locations & scope precedence

Scopes from highest to lowest priority (higher overrides lower for scalar keys; arrays merge):

| Scope | File path | Shareable |
|---|---|---|
| Enterprise managed | platform/MDM/plist/HKLM/HKCU/remote | Yes (admin-controlled) |
| Command-line args | `--allowedTools`, `--model`, etc. | No (session only) |
| Project local | `.claude/settings.local.json` | No (gitignored) |
| Project | `.claude/settings.json` | Yes (commit to repo) |
| User | `~/.claude/settings.json` | No (machine-local) |

- Array settings (`permissions.allow`, `sandbox.filesystem.allowWrite`, etc.) **concatenate and deduplicate** across scopes rather than override.
- Exception: `fallbackModel` — the highest-precedence scope that defines it supplies the entire chain.
- `version >= 2.1.175:` `availableModels` — a managed/policy value replaces lower-precedence entries entirely.
- Windows: `~/.claude` resolves to `%USERPROFILE%\.claude`.
- Run `/status` → **Status** tab → `Setting sources` line to see which files are loaded.

## Settings keys

| Key | Description |
|---|---|
| `model` | Model alias or full model ID for the main session |
| `agent` | Run the main thread as a named subagent (applies its system prompt/tools/model) and set the default agent for `claude agents` sessions |
| `fallbackModel` | Ordered fallback chain; highest-precedence scope supplies whole chain |
| `availableModels` | Restrict the model picker to this list; managed/policy value replaces lower scopes |
| `advisorModel` | `version >= 2.1.98:` model for the `/advisor` feature; alias (`"opus"`/`"sonnet"`/`"fable"`, alias support `version >= 2.1.170`) or full ID; written by `/advisor`. Disable via `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` |
| `permissions.allow` | Array of allow-rule strings; see Permissions section |
| `permissions.deny` | Array of deny-rule strings |
| `permissions.ask` | Array of ask-rule strings |
| `permissions.defaultMode` | Default permission mode; see Permission modes section |
| `permissions.additionalDirectories` | Extra paths Claude can read/write; grants file access only, not config discovery |
| `permissions.disableBypassPermissionsMode` | `"disable"` prevents `bypassPermissions` mode |
| `permissions.disableAutoMode` | `"disable"` prevents `auto` mode |
| `enforceAvailableModels` | `version >= 2.1.175:` (managed/policy) when `true` + non-empty `availableModels`, also constrains the Default option to the allowlist |
| `modelOverrides` | Map Anthropic model IDs → provider-specific IDs (Bedrock ARN, Vertex version, Foundry deployment) |
| `effortLevel` | Persist effort: `"low"`/`"medium"`/`"high"`/`"xhigh"`. `max`/`ultracode` are session-only, not accepted here |
| `alwaysThinkingEnabled` | Boolean; extended thinking on by default. `MAX_THINKING_TOKENS=0` forces off (except Fable 5) |
| `autoUpdatesChannel` | `"stable"` (≈1-week-old, skips major-regression versions) or `"latest"` (default). Disable entirely via `DISABLE_AUTOUPDATER` env |
| `cleanupPeriodDays` | Days to retain session files before auto-deletion; default 30, min 1, `0` rejected |
| `spinnerTipsEnabled` | Boolean; show spinner tips |
| `showThinkingSummaries` | Boolean; expose thinking summaries for expansion |
| `maxSkillDescriptionChars` | `version >= 2.1.105:` per-skill cap on combined `description`+`when_to_use` text in the listing (default 1536) |
| `skillListingBudgetFraction` | Fraction of model context used for skill listing |
| `outputStyle` | Output-style name; see Output styles section |
| `statusLine` | Status line config object; see Statusline section |
| `subagentStatusLine` | Per-subagent row body config object; see Statusline section |
| `sandbox` | Sandbox config object; see Sandboxed Bash tool section |
| `enabledPlugins` | Array of plugin IDs to enable |
| `extraKnownMarketplaces` | Array of additional marketplace URLs |
| `hooks` | Lifecycle event hook config; see hooks reference |
| `allowedHttpHookUrls` | Allowlist of URL patterns HTTP hooks may target (`*` wildcard); undefined = no restriction, `[]` = block all. Arrays merge across sources |
| `httpHookAllowedEnvVars` | Allowlist of env var names HTTP hooks may interpolate into headers; effective set is intersection per hook. Arrays merge across sources |
| `allowManagedHooksOnly` | Boolean (managed only); only managed/SDK hooks + hooks from managed-`enabledPlugins` plugins load |
| `disableAllHooks` | Boolean; disable all hooks AND any custom status line |
| `disableSkillShellExecution` | Boolean; replace `!` blocks with `[shell command execution disabled by policy]` (user/project/plugin/add-dir sources; bundled/managed exempt) |
| `strictPluginOnlyCustomization` | (Managed only) block skills/agents/hooks/MCP from user+project; `true` locks all, or array names a subset |
| `parentSettingsBehavior` | `version >= 2.1.133:` (managed only) `"merge"` lets embedder-supplied policy tighten (not loosen) under the admin tier; default `"first-wins"` |

## Environment variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_BASE_URL` | Override Anthropic API base URL |
| `ANTHROPIC_MODEL` | Override main session model; `--model`/`/model` override it. See `model` setting |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Override model for all subagents/agent teams; overrides per-call `model` + frontmatter `model`. `inherit` = normal resolution |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` / `_SONNET_MODEL` / `_HAIKU_MODEL` / `_FABLE_MODEL` | Full model ID the `opus`/`sonnet`/`haiku`/`fable` alias (and Default) resolves to; pin versions on third-party providers |
| `ANTHROPIC_SMALL_FAST_MODEL` | DEPRECATED; use `ANTHROPIC_DEFAULT_HAIKU_MODEL` |
| `ANTHROPIC_CUSTOM_MODEL_OPTION` | Model ID added as a custom `/model` picker entry (`_NAME`/`_DESCRIPTION`/`_SUPPORTED_CAPABILITIES` companions) |
| `ANTHROPIC_DEFAULT_OPUS_MODEL_NAME` / `_DESCRIPTION` / `_SUPPORTED_CAPABILITIES` | Display name/description/capability list for a pinned Opus model (same suffixes exist for Sonnet/Haiku/Fable/custom) |
| `CLAUDE_CODE_EFFORT_LEVEL` | Effort: `low`/`medium`/`high`/`xhigh`/`max`/`auto`; overrides `/effort` + `effortLevel` setting |
| `CLAUDECODE` | Set to `1` in all Claude-Code-spawned subprocesses (Bash/PowerShell/tmux/hook/statusline/stdio-MCP); IDE terminals also set it |
| `CLAUDE_CODE_CHILD_SESSION` | `version >= 2.1.172:` `1` in Bash/PowerShell/Monitor/hook/statusline subprocesses; NOT stdio-MCP; nested interactive sessions excluded from `--resume` unless `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT` | `1` removes 1M context variants from model picker |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | `1` reverts Opus/Sonnet 4.6 to fixed thinking budget (`MAX_THINKING_TOKENS`). `version >= 2.1.111:` no effect on Fable 5 or Opus 4.7+ (always adaptive) |
| `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` | `version >= 2.1.98:` `1` disables `/advisor`, `--advisor`, and `advisorModel` |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | `1` disables auto memory; `0` forces it on |
| `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` | `1` removes bundled skills/workflows (built-ins like `/init` hidden from model); `0` does not override the setting |
| `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` | `1` removes built-in commit/PR instructions + git-status snapshot; overrides `includeGitInstructions` |
| `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` | `1` loads CLAUDE.md/`.claude/rules/*.md`/CLAUDE.local.md from `--add-dir` directories |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | Override the context-window size Claude Code assumes for the active model; only takes effect when `DISABLE_COMPACT` is also set |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | Context capacity (tokens) used for auto-compaction calc; capped at model window; decouples threshold from statusline `used_percentage` |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | Percentage (1-100) of the compaction window at which proactive auto-compaction triggers; can only lower the threshold |
| `CLAUDE_PROJECT_DIR` | Project directory; exported to hook/plugin processes |
| `CLAUDE_PLUGIN_ROOT` | Plugin root directory; exported to hook/plugin processes |
| `CLAUDE_PLUGIN_DATA` | Plugin data directory; exported to hook/plugin processes |
| `MAX_THINKING_TOKENS` | Max thinking tokens; `0` disables thinking (except Fable 5); on fixed-budget models overrides the budget, on adaptive models sets a ceiling |
| `DISABLE_AUTOUPDATER` | `1` disables automatic update checks |

## Permissions

### Rule syntax

```
ToolName                      # bare name: matches any call to ToolName
ToolName(glob)                # positional-arg match: glob against first argument
ToolName(prefix *)            # prefix glob (trailing space + * is prefix match)
mcp__server__toolname         # specific MCP tool
mcp__server__*                # all tools from a specific MCP server (allow only)
*                             # deny/ask: every tool; NOT valid in allow rules
mcp__*                        # deny/ask: every MCP tool; NOT valid in allow rules
```

- Evaluation order: `deny` → `ask` → `allow`; first match wins, specificity does NOT reorder. A broad deny blocks even a narrower allow; a matching ask prompts even with a narrower allow.
- Allow rules: tool-name globs accepted **only** after a literal `mcp__<server>__` prefix (server segment must be glob-free); bare globs like `"*"` or `"B*"` in allow are skipped with a warning.
- Deny/ask rules: accept glob patterns in the tool-name position; pattern must match the full name (`"*"` = every tool, `"mcp__*"` = every MCP tool).
- A deny rule matching a bare tool name (or a bare-name glob) removes that tool from Claude's context; a scoped rule like `Bash(rm *)` leaves the tool present and blocks matching calls.
- A deny/ask rule whose tool name matches no known tool produces a startup warning (tool names with `_` or `*` are exempt).
- Use canonical tool names: the transcript label can differ (e.g. `Stop Task` → canonical `TaskStop`); rules/hook matchers match the canonical name only.

### Input-parameter matching (deny/ask only)

`Tool(param:value)` matches a top-level scalar input field set to that exact value (allow rules keep each tool's own specifier syntax):

| Rule | Matches |
|---|---|
| `Agent(model:opus)` | Agent calls requesting the `opus` alias (literal, pre-normalization; not a full ID) |
| `Agent(isolation:worktree)` | Agent calls requesting a git worktree |
| `Bash(run_in_background:true)` | Bash calls running in background |

- One parameter per rule; `*` is a wildcard; an omitted param is never matched (`Agent(model:*)` skips a call with no `model`).
- Canonicalized fields are NOT matchable this way: `command` (Bash/PowerShell), `file_path` (Read/Edit/Write), `path` (Grep/Glob), `notebook_path` (NotebookEdit), `url` (WebFetch) — such rules are ignored with a startup warning. Use `Bash(rm *)`, `Read(./path)`, `WebFetch(domain:host)` instead.

### Per-tool specifiers

- `Bash(cmd arg)` / `PowerShell(...)`: command string as a glob; recognizes separators (`&&`, `||`, `;`, `|`, `|&`, `&`, newlines) and matches each subcommand independently; strips wrappers `timeout`/`time`/`nice`/`nohup`/`stdbuf` and bare `xargs`. `:*` suffix == trailing ` *`.
- `Read`/`Edit`/`Write`: gitignore-anchored path patterns, NOT plain globs — `//abs` (filesystem root), `/project-relative` (project root), `~/home`, bare/`./` (cwd). Bare filename matches any depth (`Read(.env)` == `Read(**/.env)`). Merged with sandbox filesystem rules.
- `WebFetch(domain:host)`: matches URL hostname; `*.example.com` = any subdomain (not the apex); `domain:*` == bare `WebFetch`.
- `Agent(AgentName)`: gate a subagent — `Agent(Explore)`, `Agent(Plan)`, `Agent(my-custom-agent)`; add to `deny` to disable.
- `Cd(<path-pattern>)`: gates the `/cd` command (not model-invocable); any `Cd` allow rule switches `/cd` to allowlist mode.

### Permission settings keys (nested under `permissions`)

| Key | Description | Example |
|---|---|---|
| `allow` | Allow-rule strings | `["Bash(git diff *)"]` |
| `deny` | Deny-rule strings | `["Bash(rm -rf *)"]` |
| `ask` | Ask-rule strings | `["Bash(git push *)"]` |
| `defaultMode` | Starting permission mode | `"acceptEdits"` |
| `additionalDirectories` | Extra readable/writable paths (file access only) | `["/mnt/data"]` |
| `disableBypassPermissionsMode` | `"disable"` blocks `bypassPermissions` | `"disable"` |
| `disableAutoMode` | `"disable"` blocks `auto` mode | `"disable"` |

## Permission modes

Set via `permissions.defaultMode` in settings, `--permission-mode` CLI flag, or Shift+Tab in CLI.

| Mode | UI label | Description |
|---|---|---|
| `default` | Ask before edits | Prompts for permission on first use of each tool |
| `acceptEdits` | Edit automatically | Auto-accepts file edits + filesystem Bash (`mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp`, `sed`; PowerShell `Set-Content`/`Add-Content`/`Clear-Content`/`Remove-Item`) for paths in working dir / `additionalDirectories` |
| `plan` | Plan mode | Read-only: Claude reads files and runs read-only shell commands; does not edit source files. Enter via Shift+Tab or `/plan` prefix |
| `auto` | Auto mode | `version >= 2.1.83:` auto-approves with a server-side safety classifier; research preview. Explicit `ask` rules still prompt |
| `dontAsk` | — | Auto-denies tools unless matched by `permissions.allow` (or read-only Bash); explicit `ask` rules are denied, not prompted |
| `bypassPermissions` | Bypass permissions | Skips prompts; `version >= 2.1.126:` includes protected-path writes (earlier versions prompted). Explicit `ask` rules + filesystem-root/home removals still prompt |

### Protected-path behavior per mode

| Mode | Protected-path writes (`.claude/`, `.git/`, etc.) |
|---|---|
| `default`, `acceptEdits`, `plan` | Prompted |
| `auto` | Routed to safety classifier |
| `dontAsk` | Denied |
| `bypassPermissions` | Allowed |

- `bypassPermissions`: only use in isolated environments (containers/VMs); refuses to start as root/sudo on Linux/macOS unless in a recognized sandbox. Admins block it via `permissions.disableBypassPermissionsMode: "disable"`. Enter only by starting with `--permission-mode bypassPermissions` / `--dangerously-skip-permissions`.
- `dontAsk` / `bypassPermissions`: Claude Code on the web ignores these as `defaultMode` from project/local settings. `defaultMode: "auto"` is also ignored from project/local settings (`version >= 2.1.142:`) — set in user/managed settings instead.
- `auto` mode mechanics: classifier checks each non-trivial action; drops broad code-exec allow rules (`Bash(*)`, wildcarded interpreters, `Agent` allows) on entry, restores on exit. Pauses to prompting after 3 consecutive or 20 total blocks (not configurable). Subagent task descriptions are pre-checked `version >= 2.1.178:`.
- `--resume` restores the permission mode that was active at defer-time; exceptions: `plan` and `bypassPermissions` are never carried over.

## Model configuration

### Aliases

| Alias | Resolves to |
|---|---|
| `default` | Clears any model override → recommended model for account type (not itself an alias) |
| `best` | Fable 5 where the org has access, else latest Opus |
| `opus` | Latest Opus default for the configured provider |
| `sonnet` | Latest Sonnet default |
| `haiku` | Latest Haiku default (override via `ANTHROPIC_DEFAULT_HAIKU_MODEL`) |
| `fable` | Claude Fable 5 (`version >= 2.1.170:` shown in picker); for hardest/longest tasks |
| `opus[1m]` / `sonnet[1m]` | Opus/Sonnet with the 1M-token context window |
| `opusplan` | Opus for plan-mode turns; switches to Sonnet for execution |

- Aliases resolve to a built-in default model ID that may lag the newest release.
- Use full model IDs (e.g. `claude-opus-4-8`) to pin an exact version, or set `ANTHROPIC_DEFAULT_*_MODEL`.
- `[1m]` suffix: applies 1M context window to the `opus`/`sonnet` aliases (or appended to a full ID), including `opusplan`'s Opus phase (`opusplan[1m]` forces both phases). Stripped before matching `availableModels` and before sending to the provider.
- When `availableModels` excludes Opus: `opusplan` stays on Sonnet in plan mode; a Haiku session that would upgrade to Sonnet in plan mode stays on Haiku when Sonnet is excluded.

### Effort levels

`low`/`medium`/`high`/`xhigh`/`max` (model-dependent; `xhigh` `version >= 2.1.111` as a capability). Set via `/effort`, `--effort`, `CLAUDE_CODE_EFFORT_LEVEL` (highest precedence), the `effortLevel` setting, or skill/subagent frontmatter `effort`. `low`/`medium`/`high`/`xhigh` persist; `max` and `ultracode` are session-only. `ultrathink` in a prompt requests deeper reasoning for that turn without changing the level.
- When `availableModels` excludes Sonnet: implicit Haiku→Sonnet upgrade in plan mode is skipped.

### Fallback chains

```json
{
  "fallbackModel": ["claude-sonnet-4-6", "claude-haiku-4-5"]
}
```

- Position carries meaning; the highest-precedence scope that defines `fallbackModel` supplies the entire chain. Capped at 3 models after dedup; `--fallback-model` flag overrides; `"default"` expands to the default model.
- Switch lasts the current turn only; only fires on overload/unavailable/non-retryable server errors (not auth/billing/rate-limit).
- Elements outside `availableModels` or pointing at a retired model are dropped/skipped.
- Separate from content-based fallback: a flagged Fable 5 request re-runs on the default Opus model.

### Merge behavior

- `availableModels` set only in user/project/local: arrays merge + dedup.
- `availableModels` (or `enforceAvailableModels`) set in managed/policy: replaces the merged result entirely; lower scopes cannot widen. `version >= 2.1.175:` this is the only way to enforce a strict allowlist (earlier versions merged the managed list).
- `modelOverrides` maps Anthropic IDs → provider IDs; allowlist still matches the Anthropic ID, not the override value.
- All other model arrays follow the standard concatenate-and-deduplicate rule.

## Output styles

Output styles modify the system prompt to set role, tone, and output format. They do not change Claude's knowledge.

### Discovery

Output styles are markdown files loaded from:
- User: `~/.claude/output-styles/`
- Project: `.claude/output-styles/`
- Managed policy: `.claude/output-styles/` inside the managed settings directory
- Plugins: `output-styles/` inside the plugin directory

### Built-in styles

| Style | Behavior |
|---|---|
| Default | Built-in software-engineering system prompt |
| Proactive | Executes immediately, makes reasonable assumptions, prefers action; stronger than auto mode and works without changing permission mode |
| Explanatory | Adds educational "Insights" while doing software-engineering tasks |
| Learning | Collaborative learn-by-doing; adds `TODO(human)` markers for you to implement |

Project styles load from every `.claude/output-styles/` between cwd and repo root; `version >= 2.1.178:` on a name collision the directory closest to cwd wins.

### Frontmatter

| Field | Purpose | Default |
|---|---|---|
| `name` | Style name if not the file name | file name |
| `description` | Shown in the `/config` picker | none |
| `keep-coding-instructions` | Keep built-in software-engineering instructions alongside the custom style | `false` |
| `force-for-plugin` | Plugin styles only: auto-apply whenever the plugin is enabled, overriding the user's `outputStyle`; first loaded wins if several set it | `false` |

### Custom styles

- Create `<name>.md` in a discovery directory; Claude Code picks it up automatically.
- Custom styles add their instructions to the end of the system prompt and drop built-in software-engineering instructions unless `keep-coding-instructions: true`.
- All output styles (built-in and custom) trigger reminders to Claude to adhere to style instructions during the conversation.
- Output styles are **not** loaded from `--add-dir` directories (only the current working directory, parents, `~/.claude/`, and managed settings).

### Activate

Run `/config` → **Output style** (saved to `.claude/settings.local.json`), or set the `outputStyle` field directly. Applies after `/clear` or a new session (system prompt is read once at session start). The standalone `/output-style` command was deprecated v2.1.73 and removed v2.1.91.

## Statusline

A customizable bar at the bottom of Claude Code's interface. Configured via `statusLine` in settings.

### Configuration

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 2
  }
}
```

| Field | Description |
|---|---|
| `type` | Must be `"command"` |
| `command` | Shell command or path to script; runs on each status refresh |
| `padding` | Optional integer; horizontal padding around the output (default `0`) |
| `refreshInterval` | Optional; re-run the command every N seconds (min `1`) on top of event-driven updates; use for time-based data or idle periods |
| `hideVimModeIndicator` | Optional boolean; suppress the built-in `-- INSERT --` text when the script renders `vim.mode` itself |

- Use `/statusline <description>` to have Claude Code generate a script and configure `statusLine` automatically.
- Script receives JSON on stdin; print one or more lines to stdout; each line becomes a row. Runs after each assistant message, after `/compact`, on permission-mode change, and on vim-mode toggle; debounced 300ms; in-flight execution cancelled on a new trigger.
- Forward slashes in `command` paths; `~` expands to home directory on all platforms.
- `version >= 2.1.153:` read terminal size from `COLUMNS`/`LINES` env vars (`tput cols` cannot read it).
- Requires workspace trust; disabled when `disableAllHooks: true`.
- Windows: Claude Code routes through Git Bash when available, PowerShell otherwise.

### `subagentStatusLine`

Same object shape (`type`/`command`); renders a custom row body per subagent in the agent panel. stdin = base hook fields + `columns` + a `tasks` array (each: `id`, `name`, `type`, `status`, `description`, `label`, `startTime`, `tokenCount`, `tokenSamples`, `cwd`). Emit one JSON line per overridden row: `{"id":"<task id>","content":"<row body>"}`; omit `id` to keep default; empty `content` hides the row. Plugins can ship a default in their `settings.json`.

### Available data (stdin JSON fields, curated)

| Field path | Description |
|---|---|
| `model.id`, `model.display_name` | Current model id and display name |
| `cwd`, `workspace.current_dir` | Current working directory (same value) |
| `workspace.project_dir`, `workspace.added_dirs` | Launch dir; `--add-dir`/`/add-dir` dirs |
| `workspace.git_worktree` | Linked-worktree name (absent in main tree) |
| `workspace.repo.host`/`.owner`/`.name` | Repo identity from `origin` remote (absent without it) |
| `context_window.used_percentage`, `.remaining_percentage` | Context usage/remaining 0–100 (may be `null` early) |
| `context_window.context_window_size` | Max window (200000, or 1000000 for extended context) |
| `context_window.current_usage` | Per-component token counts; `null` before first call and after `/compact` |
| `cost.total_cost_usd`, `.total_duration_ms`, `.total_api_duration_ms` | Session cost / wall-clock / API-wait |
| `cost.total_lines_added`, `.total_lines_removed` | Lines changed |
| `effort.level` | `low`/`medium`/`high`/`xhigh`/`max` (absent if model has no effort) |
| `thinking.enabled` | Extended thinking on for the session |
| `rate_limits.five_hour`/`.seven_day` (`.used_percentage`, `.resets_at`) | Pro/Max only, after first API response; may be independently absent |
| `session_id`, `session_name`, `transcript_path`, `version` | Session id, custom name, transcript path, CC version |
| `output_style.name`, `vim.mode`, `agent.name` | Current style, vim mode, `--agent` name |
| `pr.number`, `pr.url`, `pr.review_state` | Open PR for branch (`review_state`: `approved`/`pending`/`changes_requested`/`draft`); absent once merged/closed |
| `worktree.*` (`name`/`path`/`branch`/`original_cwd`/`original_branch`) | `--worktree` sessions only |

- Read git branch via `git branch --show-current` inside the script; not provided in the JSON.

## Sandboxed Bash tool

OS-level filesystem and network isolation for Bash commands. Platform: macOS, Linux, WSL2.

### Enable

```json
{
  "sandbox": {
    "enabled": true
  }
}
```

### Configuration keys (under `sandbox`)

| Key | Description | Default |
|---|---|---|
| `enabled` | Enable sandboxing | `false` |
| `failIfUnavailable` | Exit at startup if sandbox cannot start; when `false` shows warning and runs unsandboxed | `false` |
| `autoAllowBashIfSandboxed` | Auto-approve Bash commands when sandboxed | `true` |
| `excludedCommands` | Commands to run outside the sandbox (glob strings) | `[]` |
| `allowUnsandboxedCommands` | Allow `dangerouslyDisableSandbox` escape hatch | `true` |
| `filesystem.allowWrite` | Paths sandboxed commands may write; merged across scopes; also merged with `Edit(...)` allow rules | `[]` |
| `filesystem.denyWrite` | Paths sandboxed commands may not write; merged across scopes; also merged with `Edit(...)` deny rules | `[]` |
| `filesystem.denyRead` | Paths sandboxed commands may not read (default read = whole machine) | `[]` |
| `filesystem.allowRead` | Re-allow specific paths within a `denyRead` region | `[]` |
| `filesystem.allowManagedReadPathsOnly` | (Managed only) honor only managed `allowRead`; `denyRead` still merges | `false` |
| `network.allowedDomains` | Domains sandboxed commands may connect to (none pre-allowed; first new domain prompts) | `[]` |
| `network.deniedDomains` | Domains sandboxed commands may not connect to | `[]` |
| `network.allowManagedDomainsOnly` | (Managed only) honor only managed `allowedDomains`/`WebFetch` allows; non-allowed blocked without prompting; denies still merge | `false` |
| `network.allowUnixSockets` | Unix socket paths accessible from within the sandbox | `[]` |
| `network.allowLocalBinding` | Allow binding to localhost ports | `false` |
| `network.httpProxyPort` / `network.socksProxyPort` | Route sandbox traffic through a custom proxy (TLS inspection / corporate proxy) | — |
| `enableWeakerNetworkIsolation` | Allow a MITM proxy + custom CA (e.g. for Go CLIs failing TLS under Seatbelt); weakens isolation | `false` |
| `allowAppleEvents` | macOS: allow Apple Events (`open`, `osascript`); honored from user/managed/CLI only (NOT project); removes code-exec isolation | `false` |
| `enableWeakerNestedSandbox` | Linux only: enable sandbox inside Docker without privileged namespaces; weakens security | `false` |

- Array keys (`filesystem.allowWrite`, etc.) **merge across all scopes**; user, project, and managed entries are combined.
- Boolean keys (`enabled`, `failIfUnavailable`): managed value wins, local ignored.
- Settings files are automatically write-denied inside the sandbox at every scope; a sandboxed command cannot modify its own policy.
- Linked git worktree: the main repo's shared `.git` is writable (so `git commit` works) but `hooks/` and `config` inside it stay denied.
- WSL2: sandboxed commands cannot launch Windows binaries (e.g. `cmd.exe`, anything under `/mnt/c/`); add such commands to `excludedCommands`.
- Security note: `allowUnixSockets` with `/var/run/docker.sock` effectively grants host access.

### Path prefixes (sandbox)

Paths in `filesystem.*` use standard conventions (NOT the `//` Read/Edit anchoring):
- Absolute paths: `/tmp/build`
- Home-relative: `~/.kube`
- `./` or no prefix: project root for project settings, but `~/.claude` for user settings.

## Version notes

| version >= X.Y | Note |
|---|---|
| `version >= 2.1.83` | `auto` permission mode (research preview) |
| `version >= 2.1.91` | standalone `/output-style` command removed (deprecated 2.1.73) |
| `version >= 2.1.98` | `advisorModel` setting + `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` |
| `version >= 2.1.105` | `maxSkillDescriptionChars` setting |
| `version >= 2.1.111` | `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` no effect on Fable 5 / Opus 4.7+; `xhigh` effort capability |
| `version >= 2.1.126` | `bypassPermissions` no longer prompts for protected-path writes |
| `version >= 2.1.133` | `parentSettingsBehavior` setting (`merge`/`first-wins`) |
| `version >= 2.1.142` | `defaultMode: "auto"` ignored from project/local settings |
| `version >= 2.1.153` | statusline scripts read `COLUMNS`/`LINES` env |
| `version >= 2.1.170` | alias model values accepted for `advisorModel`; Fable 5 in picker |
| `version >= 2.1.172` | `CLAUDE_CODE_CHILD_SESSION=1` set in Bash/PowerShell/Monitor/hook/statusline subprocesses |
| `version >= 2.1.175` | `availableModels`/`enforceAvailableModels` managed/policy value replaces lower-precedence entries entirely (no merge) |
| `version >= 2.1.178` | output-style nested-dir collision: closest-to-cwd wins; auto-mode pre-checks subagent task descriptions |
