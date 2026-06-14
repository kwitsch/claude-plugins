# Claude Code Plugins — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (Plugins, Plugins reference, Plugin marketplaces, Plugin dependencies, Plugin hints),
> verified 2026-06-14.
> Apply when creating, reviewing, or distributing a Claude Code plugin.

## What a plugin is / components

- Plugin = self-contained directory of components that extends Claude Code.
- Components: skills, agents, hooks, MCP servers, LSP servers, monitors, bin executables.
- Two loading paths: **marketplace install** (copied to plugin cache `~/.claude/plugins/cache/`) or **skills-directory** (loaded in place from `~/.claude/skills/<name>/` or `<cwd>/.claude/skills/<name>/`).
- Installed plugins cannot reference files outside their directory — no `../shared-utils`; use symlinks for shared files.
- Orphaned version directories (after update/uninstall) are auto-deleted after 7 days; Glob/Grep skip them.

## Plugin structure & layout

```
<plugin-name>/
  .claude-plugin/
    plugin.json          ← manifest (required); ONLY file inside .claude-plugin/
  skills/
    <skill-name>/
      SKILL.md
  agents/
    <agent-name>.md
  hooks/
    hooks.json
  mcp/
    server.mjs           ← self-contained stdio MCP server (chmod +x)
  bin/                   ← executables added to PATH (must be chmod +x)
  commands/              ← legacy flat .md skills; prefer skills/ for new plugins
  .mcp.json              ← MCP server configs
  .lsp.json              ← LSP server configs
  monitors/
    monitors.json        ← background monitors
  settings.json          ← default settings; only `agent` + `subagentStatusLine` keys honored
  README.md
  CLAUDE.md
```

- Only `plugin.json` goes inside `.claude-plugin/`. All component dirs live at plugin root.
- `skills/` preferred over `commands/` for new plugins.
- `bin/` executables must have executable bit set.

## plugin.json schema

Minimal required field: `name`. All others optional.

### Standard metadata fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Unique identifier; kebab-case, no spaces |
| `version` | string | No | Semver string (e.g. `1.2.0`). Omit to use git commit SHA as version. If set, users receive updates only when this field changes. |
| `displayName` | string | No | Human-readable name for UI. Falls back to `name`. version >= 2.1.143: required to take effect |
| `description` | string | No | Brief plugin description |
| `author` | object | No | `{ "name": "…" }` required; `"email"` and `"url"` optional |
| `homepage` | string | No | Plugin homepage or documentation URL |
| `repository` | string | No | Source code repository URL |
| `license` | string | No | SPDX license identifier (e.g. `MIT`, `Apache-2.0`) |
| `keywords` | array | No | Short string keywords |

### Component path override fields

Default component dirs are auto-discovered (see [Component auto-discovery](#component-auto-discovery)). These fields override the defaults.

| Field | Type | Description |
|---|---|---|
| `skills` | string \| array | Path to skills directory or array of specific SKILL.md paths |
| `commands` | string \| array | Path to commands directory or array of specific .md files |
| `agents` | string \| array | Path to agents directory or array of specific agent files |
| `hooks` | string | Path to hooks.json |
| `mcpServers` | string | Path to MCP config file (`.mcp.json`) |
| `lspServers` | string | Path to LSP config file (`.lsp.json`) |
| `outputStyles` | string | Path to output styles directory |
| `experimental.monitors` | string | Path to monitors config file |
| `dependencies` | array | Dependency declarations; see [Plugin dependencies](#plugin-dependencies) |
| `strict` | boolean | When `true`, `plugin.json` is authority for component paths; disables auto-discovery fallbacks |

### Full example

```json
{
  "name": "deployment-tools",
  "displayName": "Deployment Tools",
  "version": "1.2.0",
  "description": "Brief plugin description",
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://github.com/author"
  },
  "homepage": "https://docs.example.com/plugin",
  "repository": "https://github.com/author/plugin",
  "license": "MIT",
  "keywords": ["deploy", "ci"],
  "skills": "./custom/skills/",
  "agents": ["./custom/agents/reviewer.md"],
  "hooks": "./config/hooks.json",
  "mcpServers": "./mcp-config.json",
  "lspServers": "./.lsp.json",
  "dependencies": [
    "helper-lib",
    { "name": "secrets-vault", "version": "~2.1.0" }
  ]
}
```

## Path variables

Available as environment variables in hook scripts and MCP server processes.

| Variable | Scope | Description |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | per-version | Plugin install directory. Changes on each plugin update. Use for bundled scripts. |
| `${CLAUDE_PLUGIN_DATA}` | persistent | Persistent data dir. Survives plugin updates. Use for deps and runtime state. |
| `${CLAUDE_PROJECT_DIR}` | session | Project's `.claude/` parent directory. |

- Use exec form (`"args": []`) when referencing path variables — elements are passed verbatim, no shell tokenization.
- `plugin.json` path fields support `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` substitution.
- Plugin hooks additionally substitute `${user_config.*}` values from user configuration.

## Component auto-discovery

When `plugin.json` does not declare explicit component paths (and `strict` is not set), Claude Code discovers components from the default directories:

| Default path | Component type |
|---|---|
| `skills/` | Skills (`<name>/SKILL.md` subdirs) |
| `commands/` | Legacy flat skills (`.md` files) |
| `agents/` | Agent definitions (`.md` files) |
| `hooks/hooks.json` | Hook event handlers |
| `.mcp.json` | MCP server configurations |
| `.lsp.json` | LSP server configurations |
| `monitors/monitors.json` | Background monitors |
| `bin/` | PATH executables |
| `settings.json` | Default settings (`agent`, `subagentStatusLine` only) |

- Override any default by setting the corresponding field in `plugin.json`.
- Component dirs must be at plugin root, not inside `.claude-plugin/`.
- Skills inside a plugin are namespaced as `<plugin-name>:<skill-name>`.

## Marketplace

A marketplace is a `marketplace.json` catalog that lets users browse and install plugins via `/plugin` or CLI.

### marketplace.json schema

#### Required top-level fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Marketplace identifier (kebab-case); reserved names for Anthropic official use are blocked |
| `owner` | object | `{ "name": "…" }` required; `"email"` optional |
| `plugins` | array | List of plugin entries |

#### Optional top-level fields

| Field | Type | Description |
|---|---|---|
| `description` | string | Brief marketplace description |
| `$schema` | string | JSON Schema URL for editor validation; ignored at load time |
| `metadata.pluginRoot` | string | Base dir prepended to relative plugin source paths |
| `allowCrossMarketplaceDependenciesOn` | array | Other marketplace names plugins in this marketplace may depend on |

#### Plugin entry fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Plugin identifier |
| `source` | string \| object | Yes | Where to fetch the plugin; see source types below |
| `description` | string | No | Brief plugin description |
| `author` | object | No | `{ "name": "…", "email": "…" }` |
| `category` | string | No | Single category string |
| `tags` | array | No | Short keyword strings |

Do NOT add `version` to marketplace entries — `plugin.json` is the single source of truth for version.

#### Plugin source types

| Source form | Fields | Notes |
|---|---|---|
| Relative path | `string` starting with `./` | Local dir within the marketplace repo. Resolved relative to marketplace root. |
| `github` | `repo`, `ref?`, `sha?` | GitHub `owner/repo` |
| `url` | `url`, `ref?`, `sha?` | Git URL; also accepts `owner/repo` shorthand or SSH URL |
| `git-subdir` | `url`, `path`, `ref?`, `sha?` | Subdirectory within a git repo; sparse clone |
| `npm` | `package`, `version?`, `registry?` | Installed via `npm install` |

- When both `ref` and `sha` are set, `sha` is the effective pin.
- Omitting `version` from `plugin.json` uses git commit SHA as version (live update on every commit).

### Validate marketplace

```bash
claude plugin validate .
```

## Plugin dependencies

A plugin can depend on other plugins. Declare in `plugin.json` `dependencies` array:

```json
"dependencies": [
  "helper-lib",
  { "name": "secrets-vault", "version": "~2.1.0" },
  { "name": "other-plugin", "marketplace": "other-marketplace" }
]
```

### Dependency fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Plugin name. Resolved within the same marketplace by default. |
| `version` | string | No | Semver range (e.g. `~2.1.0`, `^2.0`, `>=1.4`, `=2.1.0`). Fetched at the highest tagged version satisfying this range. |
| `marketplace` | string | No | Different marketplace to resolve `name` in. Requires the target to be listed in `allowCrossMarketplaceDependenciesOn`. |

- Version ranges use Node `semver` syntax: `^`, `~`, `-` (hyphen), comparator ranges.
- Pre-release versions excluded unless range opts in with a pre-release suffix (e.g. `^2.0.0-0`).
- Tag convention for pinning: `{plugin-name}--v{version}` git tags.
- `enable` and `disable` cascade: enabling a plugin enables its dependencies transitively; disabling fails if another enabled plugin depends on the target.

## Plugin hints

Lets a CLI/SDK prompt Claude Code users to install a plugin when the CLI detects it is running inside Claude Code.

### Mechanism

1. CLI writes a one-line marker to stderr (Claude Code scans both stdout and stderr; stderr recommended to avoid breaking shell pipelines).
2. Gate emission on an env var to avoid showing the hint to human users running the CLI directly.
3. Claude Code strips the marker from output and shows a one-time install prompt.
4. User selects Yes → plugin installed to user scope. Selecting "No, and don't show again" disables all future hint prompts for the user.

### Gate variables

| Variable | Set when |
|---|---|
| `CLAUDECODE` | Running inside any Claude Code session |
| `CLAUDE_CODE_CHILD_SESSION` | Running inside a spawned Claude Code child session |

Gate on `CLAUDECODE` to prompt in all Claude Code sessions; gate on `CLAUDE_CODE_CHILD_SESSION` to restrict to child sessions only.

### Marker format

Write the tag to stderr on its own line:

```
CLAUDE_PLUGIN_HINT: <plugin-name>@<marketplace-name>
```

Example in Node.js:
```js
if (process.env.CLAUDECODE) {
  process.stderr.write('CLAUDE_PLUGIN_HINT: my-plugin@my-marketplace\n');
}
```

- Plugin must exist in the official Anthropic marketplace for the hint to be recognized.
- Marker is stripped before the output reaches the user or downstream piped commands.

## Plugin CLI

Non-interactive plugin management commands.

| Command | Syntax | Notes |
|---|---|---|
| `plugin init` | `claude plugin init <name>` | Scaffold new plugin at `~/.claude/skills/<name>/`; loads next session as `<name>@skills-dir` |
| `plugin install` | `claude plugin install <plugin> [-s scope]` | Install from marketplace; `<plugin>` = `name` or `name@marketplace`; default scope `user` |
| `plugin uninstall` | `claude plugin uninstall <plugin> [--keep-data] [-s scope]` | Remove plugin; data dir deleted unless `--keep-data` passed |
| `plugin enable` | `claude plugin enable <plugin> [-s scope]` | Enable a disabled plugin; enables dependencies transitively |
| `plugin disable` | `claude plugin disable <plugin> [-s scope]` | Disable without uninstalling; fails if another enabled plugin depends on target |
| `plugin list` | `claude plugin list` | List installed plugins |
| `plugin search` | `claude plugin search <query>` | Search available plugins across configured marketplaces |
| `plugin update` | `claude plugin update [plugin]` | Update one or all plugins |
| `plugin validate` | `claude plugin validate <path>` | Validate marketplace or plugin JSON |
| `plugin marketplace add` | `claude plugin marketplace add <source>` | Add a marketplace |
| `plugin marketplace remove` | `claude plugin marketplace remove <name> [--scope scope]` | Remove marketplace; also uninstalls its plugins when last scope |
| `plugin marketplace update` | `claude plugin marketplace update` | Refresh marketplaces from sources |
| `plugin marketplace list` | `claude plugin marketplace list` | List configured marketplaces |

### Scope values

| Scope | Description |
|---|---|
| `user` | Default. Personal scope; applies across all projects. |
| `project` | Project-scoped; requires workspace trust dialog acceptance. |
| `local` | Local only; gitignored. |

### Session flags

- `claude --plugin-dir <path>` — load a plugin dir for this session only (no install).
- `claude --plugin-url <url>` — load a plugin from URL for this session only.

## Version notes

- version >= 2.1.143: `displayName` field in `plugin.json` is recognized.
- Version lives ONLY in `.claude-plugin/plugin.json`. Never in marketplace entry.
- Omitting `version` from `plugin.json`: git commit SHA used; users get updates on every new commit.
- Setting `version` in `plugin.json`: users receive updates only on version field change; pushing commits without bumping has no effect.
- Orphaned plugin version directories cleaned up automatically 7 days after update/uninstall.
