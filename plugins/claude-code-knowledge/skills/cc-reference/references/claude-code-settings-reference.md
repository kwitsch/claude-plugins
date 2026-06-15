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
> verified: 2026-06-14

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
| `fallbackModel` | Ordered fallback chain; highest-precedence scope supplies whole chain |
| `availableModels` | Restrict the model picker to this list; managed/policy value replaces lower scopes |
| `advisorModel` | Model used by the `/advisor` feature |
| `permissions.allow` | Array of allow-rule strings; see Permissions section |
| `permissions.deny` | Array of deny-rule strings |
| `permissions.ask` | Array of ask-rule strings |
| `permissions.defaultMode` | Default permission mode; see Permission modes section |
| `permissions.additionalDirectories` | Extra paths Claude can read/write; grants file access only, not config discovery |
| `permissions.disableBypassPermissionsMode` | `"disable"` prevents `bypassPermissions` mode |
| `permissions.disableAutoMode` | `"disable"` prevents `auto` mode |
| `autoUpdaterStatus` | `"enabled"` (default) or `"disabled"` |
| `cleanupPeriodDays` | Days to retain session files before auto-deletion; default 30 |
| `spinnerTipsEnabled` | Boolean; show spinner tips |
| `showThinkingSummaries` | Boolean; expose thinking summaries for expansion |
| `maxSkillDescriptionChars` | Override per-skill description truncation cap (default 1536) |
| `skillListingBudgetFraction` | Fraction of model context used for skill listing |
| `statusLine` | Status line config object; see Statusline section |
| `sandbox` | Sandbox config object; see Sandboxed Bash tool section |
| `enabledPlugins` | Array of plugin IDs to enable |
| `extraKnownMarketplaces` | Array of additional marketplace URLs |
| `allowManagedHooksOnly` | Boolean; block user/project/plugin hooks (managed only) |
| `disableAllHooks` | Boolean; disable all hooks for the session |
| `disableSkillShellExecution` | Boolean; replace `!` blocks with placeholder text |
| `parentSettingsBehavior` | SDK: `"merge"` to accept embedder managed policy |

## Environment variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_BASE_URL` | Override Anthropic API base URL |
| `ANTHROPIC_MODEL` | Override main session model (full model ID) |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Override model used for subagents |
| `ANTHROPIC_SMALL_FAST_MODEL` | Model alias override for the `haiku` alias |
| `ANTHROPIC_DEFAULT_OPUS_MODEL_NAME` | Display name for pinned Opus model in `/model` picker |
| `ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION` | Display description for pinned Opus model |
| `ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES` | Comma-separated capability list for pinned Opus model |
| `CLAUDECODE` | Set to `1` by Claude Code for every Bash/PowerShell tool command and hook command |
| `CLAUDE_CODE_CHILD_SESSION` | `version >= 2.1.172:` set to `1` in subprocesses spawned by Bash/PowerShell/hook commands |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT` | `1` removes 1M context variants from model picker |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | `1` reverts Opus/Sonnet 4.6 to fixed thinking budget (`MAX_THINKING_TOKENS`) |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | `1` disables automatic memory capture |
| `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` | `1` loads CLAUDE.md from `--add-dir` directories |
| `CLAUDE_PROJECT_DIR` | Project directory; exported to hook/plugin processes |
| `CLAUDE_PLUGIN_ROOT` | Plugin root directory; exported to hook/plugin processes |
| `CLAUDE_PLUGIN_DATA` | Plugin data directory; exported to hook/plugin processes |
| `MAX_THINKING_TOKENS` | Fixed thinking budget when adaptive thinking is disabled |

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

- Allow rules: tool-name globs accepted **only** after a literal `mcp__<server>__` prefix; bare globs like `"*"` or `"B*"` in allow are skipped with a warning.
- Deny/ask rules: accept glob patterns in the tool-name position.
- A deny rule matching a bare tool name removes that tool from Claude's context.
- Deny from any scope blocks even if allow rules exist; `deny` is evaluated before `allow`.
- A deny/ask rule whose tool name matches no known tool produces a startup warning (tool names with `_` or `*` are exempt).

### Bash permission limitations

- `Bash(cmd arg)` matches the shell command string as a glob; does not parse into subshells or pipelines.
- `Edit(path)` and `Write(path)` accept path globs; also merged with sandbox filesystem rules.

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
| `acceptEdits` | Edit automatically | Auto-accepts file edits and common filesystem ops (`mkdir`, `touch`, `mv`, `cp`) in working dir and `additionalDirectories` |
| `plan` | Plan mode | Read-only: Claude reads files and runs read-only shell commands; does not edit source files |
| `auto` | Auto mode | Auto-approves tool calls with background safety classifier; research preview |
| `dontAsk` | — | Auto-denies tools unless pre-approved via `/permissions` or `permissions.allow` |
| `bypassPermissions` | Bypass permissions | Skips permission prompts except for explicit `ask` rules and filesystem-root/home removals |

### Protected-path behavior per mode

| Mode | Protected-path writes (`.claude/`, `.git/`, etc.) |
|---|---|
| `default`, `acceptEdits`, `plan` | Prompted |
| `auto` | Routed to safety classifier |
| `dontAsk` | Denied |
| `bypassPermissions` | Allowed |

- `bypassPermissions`: only use in isolated environments (containers/VMs). Admins block it via `permissions.disableBypassPermissionsMode: "disable"`.
- `--resume` restores the permission mode that was active at defer-time; exceptions: `plan` and `bypassPermissions` are never carried over.

## Model configuration

### Aliases

| Alias | Resolves to |
|---|---|
| `opus` | Latest Opus default for the configured provider |
| `sonnet` | Latest Sonnet default |
| `haiku` | Latest Haiku default (override via `ANTHROPIC_SMALL_FAST_MODEL`) |
| `fable` | Built-in alias (provider-specific) |
| `opusplan` | Sonnet for most turns; switches to Opus for plan-mode turns |

- Aliases resolve to a built-in default model ID that may lag the newest release.
- Use full model IDs (e.g. `claude-opus-4-5-20251101`) to pin an exact version.
- `[1m]` suffix: applies 1M context window to the `opus` and `sonnet` aliases, including `opusplan`'s Opus phase.
- When `availableModels` excludes Opus: `opusplan` stays on Sonnet in plan mode instead of switching.
- When `availableModels` excludes Sonnet: implicit Haiku→Sonnet upgrade in plan mode is skipped.

### Fallback chains

```json
{
  "fallbackModel": ["claude-sonnet-4-5", "claude-haiku-4-5"]
}
```

- Position carries meaning; the highest-precedence scope that defines `fallbackModel` supplies the entire chain.
- `version >= 2.1.175:` `availableModels` managed/policy value replaces lower-precedence entries entirely.

### Merge behavior

- `availableModels`: managed/policy value replaces lower-precedence entries; does not merge.
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

Claude Code ships built-in output styles. Three additional built-in styles are available beyond the default software-engineering mode.

### Custom styles

- Create `<name>.md` in a discovery directory; Claude Code picks it up automatically.
- Set `keep-coding-instructions: true` in frontmatter to retain built-in software-engineering instructions alongside the custom style.
- Custom styles add their instructions to the end of the system prompt.
- All output styles (built-in and custom) trigger reminders to Claude to adhere to style instructions during the conversation.
- Output styles are **not** loaded from `--add-dir` directories (only the current working directory, parents, `~/.claude/`, and managed settings).

### Activate

Use `/output-style <name>` to switch styles during a session.

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
| `padding` | Optional integer; horizontal padding around the output |

- Use `/statusline <description>` to have Claude Code generate a script and configure `statusLine` automatically.
- Script receives JSON on stdin; print one or more lines to stdout; each line becomes a row.
- Forward slashes in `command` paths; `~` expands to home directory on all platforms.
- Windows: Claude Code routes through Git Bash when available, PowerShell otherwise.

### Available data (stdin JSON fields)

| Field path | Description |
|---|---|
| `model.display_name` | Current model display name |
| `workspace.current_dir` | Current working directory |
| `context_window.used_percentage` | Context window usage 0–100 |
| `cost.total_cost_usd` | Cumulative session cost in USD |
| `cost.total_duration_ms` | Cumulative session duration in ms |

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
| `filesystem.denyRead` | Paths sandboxed commands may not read | `[]` |
| `network.allowedDomains` | Domains sandboxed commands may connect to | `[]` |
| `network.deniedDomains` | Domains sandboxed commands may not connect to | `[]` |
| `network.allowUnixSockets` | Unix socket paths accessible from within the sandbox | `[]` |
| `network.allowLocalBinding` | Allow binding to localhost ports | `false` |
| `enableWeakerNestedSandbox` | Linux only: enable sandbox inside Docker without privileged namespaces; weakens security | `false` |

- Array keys (`filesystem.allowWrite`, etc.) **merge across all scopes**; user, project, and managed entries are combined.
- Settings files are automatically write-denied inside the sandbox; a sandboxed command cannot modify its own policy.
- WSL2: sandboxed commands cannot launch Windows binaries (e.g. `cmd.exe`, anything under `/mnt/c/`); add such commands to `excludedCommands`.
- Security note: `allowUnixSockets` with `/var/run/docker.sock` effectively grants host access.

### Path prefixes (sandbox)

Paths in `filesystem.allowWrite` / `filesystem.denyWrite` / `filesystem.denyRead` support:
- Absolute paths: `/etc`
- Home-relative: `~/.kube`
- Project-relative: `./build` (relative to `CLAUDE_PROJECT_DIR`)

## Version notes

| version >= X.Y | Note |
|---|---|
| `version >= 2.1.172` | `CLAUDE_CODE_CHILD_SESSION=1` set in Bash/PowerShell/hook subprocesses |
| `version >= 2.1.175` | `availableModels` managed/policy value replaces lower-precedence entries entirely (no merge) |
