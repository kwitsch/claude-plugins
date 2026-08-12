# Claude Code Plugins — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (Plugins, Plugins reference, Plugin marketplaces, Plugin dependencies, Plugin hints),
> verified 2026-08-13.
> Apply when creating, reviewing, or distributing a Claude Code plugin.
> Hook events/schema, agent frontmatter, MCP server config, and settings keys are owned by
> sibling refs (claude-code-hooks-reference.md, -agents-, -mcp-, -settings-); kept pointer-level here.

## What a plugin is / components

- Plugin = self-contained directory of components that extends Claude Code.
- Components: skills, agents, hooks, MCP servers, LSP servers, monitors, themes, bin executables.
- Two loading paths: **marketplace install** (copied to plugin cache `~/.claude/plugins/cache/`) or **skills-directory** (loaded in place from `~/.claude/skills/<name>/` or `<cwd>/.claude/skills/<name>/` as `<name>@skills-dir`).
- Installed plugins cannot reference files outside their directory — no `../shared-utils`; use symlinks for shared files (see [Symlink resolution](#symlink-resolution)).
- Orphaned version directories (after update/uninstall) are auto-deleted after 14 days; Glob/Grep skip them. Grace period lets concurrent sessions on the old version keep running.
- `CLAUDE.md` at plugin root is NOT loaded as project context — ship instructions via a skill.
- Single-skill plugin: a `SKILL.md` at plugin root (no `skills/` dir, no `skills` manifest field) loads as one skill (version >= 2.1.142). Invocation name = frontmatter `name`, else directory basename — ALWAYS set frontmatter `name`, since the basename fallback for a marketplace-installed plugin is the install dir, a version string that changes on every update.
- Plugin-shipped agents accept only `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `background`, `isolation` (sole value `"worktree"`); `hooks`, `mcpServers`, `permissionMode` are rejected in plugin agents for security.
- Boolean frontmatter in plugin skills/commands (e.g. `disable-model-invocation`) also accepts `yes`/`no`/`on`/`off`/`1`/`0`, any casing (version >= 2.1.218; earlier only `true`/`false`).
- Hooks targeting the plugin's OWN bundled MCP server need scoped names: matcher/`if` take `mcp__plugin_<plugin>_<server>__<tool>`, an `mcp_tool` hook's `server` takes `plugin:<plugin>:<server>`. A matcher on the bare `.mcp.json` key never fires.

## Plugin structure & layout

```
<plugin-name>/
  .claude-plugin/
    plugin.json          ← manifest (optional; name derived from dir if absent); ONLY file inside .claude-plugin/
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
  workflows/             ← workflow script files
  output-styles/         ← output style .md files
  themes/                ← color theme .json files (experimental)
  .mcp.json              ← MCP server configs
  .lsp.json              ← LSP server configs
  monitors/
    monitors.json        ← background monitors (experimental)
  settings.json          ← default settings; only `agent` + `subagentStatusLine` keys honored
  README.md
  CLAUDE.md              ← NOT loaded as project context
```

- Only `plugin.json` goes inside `.claude-plugin/`. All component dirs live at plugin root.
- `skills/` preferred over `commands/` for new plugins.
- `bin/` executables must have executable bit set.

## plugin.json schema

The manifest is optional (auto-discovery + dir-name fallback when absent). If present, `name` is the only required field; all others optional.

### Standard metadata fields

| Field            | Type    | Required | Description                                                                                                                                                                                                                        |
| ---------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | string  | Yes      | Unique identifier; kebab-case, no spaces. Used for component namespacing. If a marketplace entry lists the plugin under a different `name`, the marketplace entry's name is authoritative for `enabledPlugins` keys and `/plugin`. |
| `version`        | string  | No       | Semver string (e.g. `1.2.0`). Omit to use git commit SHA as version. If set, users receive updates only when this field changes.                                                                                                   |
| `displayName`    | string  | No       | Human-readable name shown in `/plugin` picker + UI. Falls back to `name`. May contain spaces/any casing; not used for namespacing or lookup. version >= 2.1.143.                                                                   |
| `description`    | string  | No       | Brief plugin description                                                                                                                                                                                                           |
| `author`         | object  | No       | `{ "name": "…" }` required; `"email"` and `"url"` optional                                                                                                                                                                         |
| `homepage`       | string  | No       | Plugin homepage or documentation URL                                                                                                                                                                                               |
| `repository`     | string  | No       | Source code repository URL                                                                                                                                                                                                         |
| `license`        | string  | No       | SPDX license identifier (e.g. `MIT`, `Apache-2.0`)                                                                                                                                                                                 |
| `keywords`       | array   | No       | Short string keywords                                                                                                                                                                                                              |
| `metadata`       | object  | No       | version >= 2.1.222. Free-form object for the author's own data (catalog/entitlement fields, …); Claude Code never reads it. Non-object value is ignored with a `validate` warning. Earlier versions treat the key as unrecognized. |
| `defaultEnabled` | boolean | No       | version >= 2.1.154. `false` ships the plugin installed-but-disabled (user opts in). Defaults `true`. See [Default enablement](#default-enablement). Marketplace-entry `defaultEnabled` overrides this.                             |
| `$schema`        | string  | No       | JSON Schema URL for editor autocomplete; ignored at load time.                                                                                                                                                                     |

### Component path override fields

Default component dirs are auto-discovered (see [Component auto-discovery](#component-auto-discovery)). These fields override the defaults.

| Field                   | Type                      | Description                                                                                                                                                                                                                                | Default behavior                          |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `skills`                | string \| array           | Skill dirs (`<name>/SKILL.md`) or specific SKILL.md paths                                                                                                                                                                                  | ADDS to default `skills/` scan            |
| `commands`              | string \| array           | Flat `.md` skill files/dirs                                                                                                                                                                                                                | REPLACES default `commands/`              |
| `agents`                | string \| array           | Agent files                                                                                                                                                                                                                                | REPLACES default `agents/`                |
| `workflows`             | string \| array           | Workflow script files/dirs                                                                                                                                                                                                                 | REPLACES default `workflows/`             |
| `hooks`                 | string \| array \| object | hooks.json path(s) or inline config                                                                                                                                                                                                        | own merge rules                           |
| `mcpServers`            | string \| array \| object | MCP config path(s) or inline config                                                                                                                                                                                                        | own merge rules                           |
| `lspServers`            | string \| array \| object | LSP config path(s) or inline config                                                                                                                                                                                                        | own merge rules                           |
| `outputStyles`          | string \| array           | Output style files/dirs                                                                                                                                                                                                                    | REPLACES default `output-styles/`         |
| `experimental.themes`   | string \| array           | Color theme `.json` files/dirs (each `{ "name", "base": <preset, e.g. dark>, "overrides": {token:hex} }`); appear in `/theme` as `custom:<plugin>:<slug>`, read-only; `Ctrl+E` in `/theme` copies one into `~/.claude/themes/` for editing | REPLACES default `themes/`                |
| `experimental.monitors` | string \| array           | Monitors config path                                                                                                                                                                                                                       | REPLACES default `monitors/monitors.json` |
| `userConfig`            | object                    | Values prompted at enable time; see [userConfig](#userconfig)                                                                                                                                                                              | —                                         |
| `channels`              | array                     | Message-injection channels bound to plugin MCP servers; each `{ "server": "<mcpKey>", "userConfig"?: {…} }`                                                                                                                                | —                                         |
| `dependencies`          | array                     | Dependency declarations; see [Plugin dependencies](#plugin-dependencies)                                                                                                                                                                   | —                                         |

- **Path-behavior rule**: REPLACE fields (`commands`, `agents`, `workflows`, `outputStyles`, `experimental.themes`, `experimental.monitors`) skip the default dir entirely; to keep it, list it explicitly (e.g. `"commands": ["./commands/", "./extras/"]`). `skills` always ADDS. Exception: a marketplace entry whose `source` resolves to the marketplace root — declaring specific skill subdirs REPLACES the default scan.
- All custom paths must be relative, start with `./`, resolve from plugin root — except `skills`, which also accepts bare `.` (same as `./`, the plugin root); version >= 2.1.221 required for `.` to validate, use `./` for earlier versions.
- version >= 2.1.140: when both a default folder and its manifest key exist, the ignored folder is flagged in `/doctor`, `plugin list`, `/plugin` detail (plugin still loads via manifest paths). No warning when the manifest key points INTO the default folder (e.g. `"commands": ["./commands/deploy.md"]`) — that path names the folder explicitly.
- `experimental.themes`/`experimental.monitors` may currently also be set at top level (`themes`/`monitors`); `validate` warns, a future release will require `experimental.*`.

### Unrecognized fields

- Top-level fields Claude Code does not recognize are ignored — one manifest can double as a VS Code/Cursor/npm/MCPB manifest. Loads at runtime.
- `claude plugin validate` reports unrecognized fields as **warnings** (with a suggestion if 1-2 chars off a known field); wrong-type fields (e.g. `keywords` as string) are load **errors** — except `experimental` and `metadata`, where a non-object value is ignored with a warning instead of failing to load.
- `validate --strict` treats warnings as errors (use in CI).

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
  "experimental": { "themes": "./themes/", "monitors": "./monitors.json" },
  "dependencies": ["helper-lib", { "name": "secrets-vault", "version": "~2.1.0" }]
}
```

### Default enablement

- version >= 2.1.154. `defaultEnabled: false` ships a plugin installed-disabled; user enables via `claude plugin enable <plugin>` or `/plugin`. Earlier versions ignore the field and enable on install.
- Precedence over `defaultEnabled`: (1) user's `enabledPlugins` entry at any scope (persists across updates/reinstalls); (2) a dependency requirement — when required by an active plugin, Claude Code writes `true` for it explicitly at install/enable, so its own default no longer applies.
- Marketplace-entry `defaultEnabled` overrides the `plugin.json` value.

### userConfig

Values Claude Code prompts for when the plugin is enabled (instead of hand-editing settings.json). Keys must be valid identifiers.

| Field         | Required | Description                                                                                    |
| ------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `type`        | Yes      | One of `string`, `number`, `boolean`, `directory`, `file`                                      |
| `title`       | Yes      | Label in the config dialog                                                                     |
| `description` | Yes      | Help text under the field                                                                      |
| `sensitive`   | No       | `true` masks input + stores in secure storage (keychain, ~2 KB total limit), not settings.json |
| `required`    | No       | `true` fails validation when empty                                                             |
| `default`     | No       | Value used when user provides nothing                                                          |
| `multiple`    | No       | For `string`, allow an array                                                                   |
| `min` / `max` | No       | Bounds for `number`                                                                            |

- Substituted as `${user_config.KEY}` in MCP/LSP server configs (except MCP `headersHelper`) and exec-form hook commands; non-sensitive also in skill/agent content.
- version >= 2.1.207: fields that run through a shell REJECT `${user_config.*}` — the component fails with an error instead of substituting. Affects shell-form hook commands, monitor commands, MCP `headersHelper`. Instead: exec form (`args`) or read `CLAUDE_PLUGIN_OPTION_<KEY>` from the hook env; monitor/`headersHelper` scripts read the value from a config file they own. Earlier versions substituted.
- All values exported to hook processes as `CLAUDE_PLUGIN_OPTION_<KEY>` env vars (`<KEY>` = key uppercased). Monitor processes do NOT receive them.
- Non-sensitive stored in settings.json under `pluginConfigs[<plugin-id>].options`; sensitive go to keychain (or `~/.claude/.credentials.json`).
- version >= 2.1.207: `pluginConfigs` is read ONLY from user settings, `--settings`/SDK inline settings, managed settings (precedence managed > `--settings` > user); `--setting-sources` narrows further. Project `.claude/settings.json` + `.claude/settings.local.json` entries are IGNORED (a cloned repo could otherwise feed values into hook/MCP/LSP/monitor commands); earlier versions read them. `pluginConfigs`-only — `enabledPlugins` still honors project/local.

## Path variables

Available as environment variables in hook scripts and MCP server processes.

| Variable                | Scope       | Description                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `${CLAUDE_PLUGIN_ROOT}` | per-version | Plugin install directory. Changes on each plugin update; old dir kept ~14 days then cleaned. Ephemeral — do NOT write state here. Use for bundled scripts/binaries.                                                                                                                                                                                       |
| `${CLAUDE_PLUGIN_DATA}` | persistent  | Persistent data dir, survives updates. Resolves to `~/.claude/plugins/data/{id}/` (`{id}` = plugin id, non-`[a-zA-Z0-9_-]` chars → `-`; e.g. `formatter@my-marketplace` → `formatter-my-marketplace`). Created on first reference. Use for deps (`node_modules`, venv), caches, runtime state. Deleted on uninstall from last scope unless `--keep-data`. |
| `${CLAUDE_PROJECT_DIR}` | session     | Project root (same dir hooks receive).                                                                                                                                                                                                                                                                                                                    |

- All three are exported as env vars to hook + MCP/LSP subprocesses. Inline substitution is per component: skill/agent content and hook/monitor commands → anywhere the placeholder appears; MCP `stdio` → `command`, `args`, `env`; MCP `http`/`sse`/`ws` → `url`, `headers`, `headersHelper`; LSP → `command`, `args`, `env`, `workspaceFolder`.
- Use exec form (`"args": []`) for `${CLAUDE_PLUGIN_ROOT}` in hooks (passed as one arg, no quoting); in shell-form hooks/monitor commands wrap in double quotes.
- On mid-session plugin update, hooks/monitors/MCP/LSP keep the old path; `/reload-plugins` switches hooks/MCP/LSP to the new path, monitors need a session restart.
- Plugin hook/monitor commands additionally substitute any `${ENV_VAR}`; `${user_config.*}` resolves only in exec-form hook commands and MCP/LSP configs other than MCP `headersHelper` (see [userConfig](#userconfig)).
- Dependency-reinstall pattern: a `SessionStart` hook `diff`s bundled `${CLAUDE_PLUGIN_ROOT}/package.json` vs `${CLAUDE_PLUGIN_DATA}/package.json`; reinstall when they differ (directory-existence check alone misses dependency-manifest changes across updates).

## Component auto-discovery

The manifest is optional. When `plugin.json` is absent or does not declare explicit component paths, Claude Code discovers components from the default directories (and derives the plugin name from the directory name when there is no manifest):

| Default path             | Component type                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `skills/`                | Skills (`<name>/SKILL.md` subdirs)                                                                  |
| `commands/`              | Legacy flat skills (`.md` files)                                                                    |
| `agents/`                | Agent definitions (`.md` files)                                                                     |
| `workflows/`             | Workflow script files                                                                               |
| `output-styles/`         | Output style `.md` files                                                                            |
| `themes/`                | Color theme `.json` files (experimental)                                                            |
| `hooks/hooks.json`       | Hook event handlers                                                                                 |
| `.mcp.json`              | MCP server configurations                                                                           |
| `.lsp.json`              | LSP server configurations                                                                           |
| `monitors/monitors.json` | Background monitors (experimental)                                                                  |
| `bin/`                   | PATH executables (invokable as bare commands in Bash tool while enabled)                            |
| `settings.json`          | Default settings (`agent`, `subagentStatusLine` only); takes priority over `plugin.json` `settings` |

- Override any default by setting the corresponding field in `plugin.json`.
- Component dirs must be at plugin root, not inside `.claude-plugin/`.
- Skills inside a plugin are namespaced as `<plugin-name>:<skill-name>`.

## Marketplace

A marketplace is a `marketplace.json` catalog that lets users browse and install plugins via `/plugin` or CLI.

### marketplace.json schema

#### Required top-level fields

| Field     | Type   | Description                                                                                                                                               |
| --------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`    | string | Marketplace identifier (kebab-case); public-facing. One marketplace per name per user (re-adding same name replaces). Reserved names blocked (see below). |
| `owner`   | object | `{ "name": "…" }` required; `"email"` optional                                                                                                            |
| `plugins` | array  | List of plugin entries                                                                                                                                    |

Reserved marketplace names (Anthropic official; cannot be used by third parties): `claude-code-marketplace`, `claude-code-plugins`, `claude-plugins-official`, `claude-plugins-community`, `claude-community`, `anthropic-marketplace`, `anthropic-plugins`, `agent-skills`, `anthropic-agent-skills`, `knowledge-work-plugins`, `life-sciences`, `claude-for-legal`, `claude-for-financial-services`, `financial-services-plugins`, `first-party-plugins`, `healthcare`. Impersonating names (e.g. `official-claude-plugins`) also blocked. Checked on every marketplace load, not only on add — version >= 2.1.205: a marketplace already registered under a name that later became reserved stops loading (`registered from an untrusted source`); remove + re-add under a different name (earlier versions kept it loading). Anthropic's own: `claude-plugins-official` (curated by Anthropic; auto-registered on first interactive launch, non-interactive scripts add it explicitly via `claude plugin marketplace add anthropics/claude-plugins-official`) and `claude-community` (public community catalog; add source `anthropics/claude-plugins-community`, install as `<plugin>@claude-community`).

#### Optional top-level fields

| Field                                 | Type   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`                         | string | Brief marketplace description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `version`                             | string | Marketplace manifest version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `$schema`                             | string | JSON Schema URL for editor validation; ignored at load time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `metadata.pluginRoot`                 | string | Base dir prepended to relative plugin source paths (e.g. `"./plugins"` lets you write `"source": "formatter"` for `"./plugins/formatter"`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `allowCrossMarketplaceDependenciesOn` | array  | Other marketplace names plugins in this marketplace may depend on (root marketplace's allowlist only is consulted)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `renames`                             | object | version >= 2.1.193. Map a former plugin `name` → its current name, or `null` if removed; lets existing users auto-migrate instead of hitting `plugin-not-found`. Append-only (never edit a prior entry, add a new one); chains are followed; `claude plugin validate .` rejects cycles or chains that don't terminate at `null`/a listed name. Rename notice rewrites `enabledPlugins`/`pluginConfigs` keys once; renamed remote-source (`github`/`npm`) plugins need one `/plugin install` to fetch under the new name (`plugin-cache-miss` until then). Managed/policy-scoped entries can't self-rewrite — notice recurs until an admin updates them. |

`description` and `version` are also accepted under `metadata` for backward compatibility.

#### Plugin entry fields

An entry may carry ANY field from the [plugin.json schema](#standard-metadata-fields) (`description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `displayName`, `defaultEnabled`, `metadata`, plus component-path fields `skills`/`commands`/`agents`/`hooks`/`mcpServers`/`lspServers`) plus these marketplace-specific fields:

| Field       | Type             | Required | Description                                                                                                                                                                                                                                                                            |
| ----------- | ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`      | string           | Yes      | Plugin identifier (kebab-case)                                                                                                                                                                                                                                                         |
| `source`    | string \| object | Yes      | Where to fetch the plugin; see source types below                                                                                                                                                                                                                                      |
| `category`  | string           | No       | Single category string                                                                                                                                                                                                                                                                 |
| `tags`      | array            | No       | Short keyword strings                                                                                                                                                                                                                                                                  |
| `strict`    | boolean          | No       | Default `true`. `true` = `plugin.json` is authority, marketplace entry SUPPLEMENTS (both merged). `false` = marketplace entry is the WHOLE definition; if `plugin.json` also declares components → conflict, plugin fails to load (lets a marketplace operator restructure raw files). |
| `relevance` | object           | No       | version >= 2.1.152. Signals telling Claude Code when to suggest this plugin to users; effective only for marketplaces an admin allowlists in managed settings.                                                                                                                         |

Do NOT add `version` to marketplace entries when `plugin.json` already carries it — `plugin.json` wins silently and a stale value can mask the marketplace value. (Repo convention: keep version in `plugin.json` only.)

#### Plugin source types

| Source form   | Fields                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relative path | `string` starting with `./`        | Local dir within the marketplace repo. Resolved relative to the **marketplace root** (dir containing `.claude-plugin/`), NOT the `.claude-plugin/` dir. No `../`. Only resolves when the marketplace is added via git, not via a direct URL to `marketplace.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `github`      | `repo`, `ref?`, `sha?`             | object; `repo` = GitHub `owner/repo`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `url`         | `url`, `ref?`, `sha?`              | object; full git URL (`https://` or `git@`); `.git` suffix optional (Azure DevOps / CodeCommit work)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `git-subdir`  | `url`, `path`, `ref?`, `sha?`      | object; subdir within a git repo (sparse partial clone). `url` also accepts `owner/repo` shorthand or SSH URL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm`         | `package`, `version?`, `registry?` | object; installed via `npm install`; `registry` defaults to system npm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `archive`     | `url`, `sha256?`                   | object; zip downloaded over HTTPS — installs without git/npm on the user's machine. `.claude-plugin/` must sit at the archive top or one folder down (Claude Code doesn't look deeper). Rejects `http://` and loopback/link-local/cloud-metadata hosts, on every redirect hop too; refuses archives > 256 MiB. `sha256` (64 hex chars) pins the exact file — mismatch refuses install with `Plugin archive integrity check failed`. Headers from a `headers`-bearing `extraKnownMarketplaces` URL source forward to an archive download only when it shares the marketplace URL's origin (scheme+host+port); dropped across any redirect that leaves that origin. version >= 2.1.224 — v2.1.120-2.1.223 the install fails with an unsupported-source-type error; earlier versions fail to load the whole marketplace. |

- For git sources (`github`/`url`/`git-subdir`), when both `ref` and `sha` are set, `sha` is the effective pin. `sha` = full 40-char commit SHA. On hosts that support fetching a commit by SHA (GitHub, GitLab, Bitbucket) install succeeds even if the `ref` branch/tag was deleted upstream, as long as the commit is reachable; on servers that do not (e.g. AWS CodeCommit) the `ref` must still exist and the pinned commit be reachable from it.
- Plugin source (per-entry `source`) ≠ marketplace source (where `marketplace.json` itself is fetched; set via `plugin marketplace add` / `extraKnownMarketplaces`; supports `ref` but not `sha`).
- Marketplace-root source (`source: "./"`) with shared `skills/`: list specific subdirs in `skills` so each entry loads only its own (the listed paths are the complete set; listing `./skills/` or the plugin root keeps the full scan; if none of the listed paths exist, the default scan runs).

### Validate marketplace

```bash
claude plugin validate .                   # validates marketplace.json: schema, dup names, source traversal, version mismatches
claude plugin validate ./plugins/my-plugin # validates a plugin: plugin.json + skill/agent/command/hook files
```

- For each entry whose `source` is a local path, `validate .` also validates that plugin's own `plugin.json` and warns on a `version` mismatch; problems are prefixed `plugins[N] plugin.json →`. Non-blocking warnings: no plugins defined, no marketplace `description`, plugin `name` not kebab-case (Claude Code loads other forms, but the claude.ai marketplace sync rejects them).
- version >= 2.1.196: the per-entry pass additionally covers entries whose `source` is `.`, runs when `marketplace.json` sits outside a `.claude-plugin/` dir (resolving against that file's own directory), and reports each entry's problems even when another part of the file has schema errors. Earlier versions skip marketplace-root plugins and only descend from `.claude-plugin/marketplace.json`.
- version >= 2.1.221: adds non-blocking warnings for Claude Desktop's managed-marketplace sync (which Claude Code itself ignores): a marketplace named `org`/`org-provisioned`/`unknown` (any casing) is rejected outright by that sync; a marketplace/plugin `name` over 128 chars or outside `[A-Za-z0-9._-]`/not starting with a letter-or-digit is rejected (marketplace) or silently dropped (plugin) by it. Earlier versions don't run these checks.

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

| Field         | Type   | Required | Description                                                                                                            |
| ------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `name`        | string | Yes      | Plugin name. Resolved within the same marketplace by default.                                                          |
| `version`     | string | No       | Semver range (e.g. `~2.1.0`, `^2.0`, `>=1.4`, `=2.1.0`). Fetched at the highest tagged version satisfying this range.  |
| `marketplace` | string | No       | Different marketplace to resolve `name` in. Requires the target to be listed in `allowCrossMarketplaceDependenciesOn`. |

- Bundle pattern: a manifest can consist of only `name` + `dependencies` (no components of its own) — installing it pulls in every dependency, letting a maintainer package a curated plugin set (e.g. a team's standard toolkit) behind one `claude plugin install`.
- version >= 2.1.110 required for dependency version constraints.
- Version ranges use Node `semver` syntax: `^`, `~`, `-` (hyphen), comparator ranges.
- Pre-release versions excluded unless range opts in with a pre-release suffix (e.g. `^2.0.0-0`).
- Resolution: against git tags `{plugin-name}--v{version}` (version matches that commit's `plugin.json`). Create with `claude plugin tag --push` (validates contents, checks plugin.json/marketplace-entry version agree, requires clean tree, refuses if tag exists; `--dry-run`, `--force`). Resolved tag's semver is recorded separately from `plugin.json`; the tag-resolved cache dir name includes a 12-char commit-SHA suffix, so force-moving a tag to a new commit gets a fresh cache dir instead of reusing stale content. For `npm` sources, constraint does NOT control fetched version (tag-resolution is git-only) but is checked at load → `dependency-version-unsatisfied` if violated. version >= 2.1.196: a marketplace added as a local folder path resolves tags the same way when the folder is a git repo; earlier versions (or a non-git folder) install from the folder's current contents instead. For a relative-path plugin (in a git-hosted marketplace) with no tag satisfying the range, Claude Code installs the marketplace's current copy instead of erroring, then checks the constraint at load; a remote git source (`github`/`url`/`git-subdir`) with no matching tag fails outright with `no-matching-tag`.
- Multiple constraints on one dependency: ranges intersected, resolved to highest version satisfying all. Unsatisfiable combos → `range-conflict` (install of the conflicting plugin fails; others stay); the message names the cause — no version satisfies all ranges, invalid semver syntax, or ranges too complex to intersect (simplify long `||` chains). Auto-update fetches a constrained dependency at the highest tag satisfying every installed plugin's range; if none satisfies all, the update is skipped and surfaces in `/doctor` + the `/plugin` Errors tab, naming the constraining plugin. Uninstalling the last plugin that constrains a dependency releases the hold — it resumes tracking its marketplace entry on the next update.
- Missing dependency recovery: `/reload-plugins` and background auto-update reinstall a missing dependency automatically if its marketplace is already configured; re-running `claude plugin install <dependent>`, or adding the marketplace with `claude plugin marketplace add`, also resolves it. A dependency from a marketplace you have not added stays unresolved.
- Cross-marketplace: `{ "name": …, "marketplace": "other-mp" }` requires `other-mp` in the **root** marketplace's `allowCrossMarketplaceDependenciesOn` (trust does not chain); else `cross-marketplace` error. User can install the dep manually first to satisfy it.
- `enable`/`disable` cascade (version >= 2.1.143): enabling enables deps transitively at the same scope (writes explicit `true`, overriding the dep's own `defaultEnabled: false`); disabling fails if another enabled plugin depends on the target (error gives a chained disable command). Enable failure names the specific blocker: dependency not installed (prints the `claude plugin install` command), blocked by org policy, or force-disabled at a higher-precedence scope (enable it there, or pass `--scope`). Earlier versions enable/disable only the named plugin → `dependency-unsatisfied` on next load.
- Orphan cleanup: auto-installed deps stay after their dependents are uninstalled; `claude plugin prune` (version >= 2.1.121) removes deps no installed plugin requires (`--dry-run`, `-y`, `--scope`), or `claude plugin uninstall <plugin> --prune`. Plugins you installed directly are never pruned. Prints `Nothing to prune` when nothing qualifies (expected on a fresh install, not an error). When stdin/stdout is not a TTY, orphans are listed and nothing is removed unless `-y` is passed.
- Dependency errors (`dependency-unsatisfied`, `range-conflict`, `dependency-version-unsatisfied`, `no-matching-tag`) surface in `plugin list`, `/plugin`, `/doctor`; affected plugin is disabled until resolved. Read `errors` field via `claude plugin list --json`.

## Skills-directory plugins

Any folder under a skills directory that contains `.claude-plugin/plugin.json` loads as `<name>@skills-dir` next session — no marketplace, no install, discovered in place (not copied to cache). Scaffold with `claude plugin init`.

| What you have                                 | What it is                                                 |
| --------------------------------------------- | ---------------------------------------------------------- |
| `<skills-dir>/foo/SKILL.md`, no manifest      | Plain skill `foo`                                          |
| `<skills-dir>/foo/.claude-plugin/plugin.json` | Plugin `foo@skills-dir` (can bundle skills/agents/hooks/…) |
| `<plugin>/skills/bar/SKILL.md`                | Skill `bar` inside a plugin                                |

| Skills dir              | Scope    | Loads                                 |
| ----------------------- | -------- | ------------------------------------- |
| `~/.claude/skills/`     | personal | In every project; no restrictions     |
| `<cwd>/.claude/skills/` | project  | Only after the workspace trust dialog |

- Project-scope `@skills-dir` plugins: MCP servers go through per-server approval; LSP starts only after trust; background monitors do NOT load.
- Project-scope `@skills-dir` plugins load only from the `.claude/skills/` of the launch directory — they do NOT walk up to repo root. Launch from repo root or `/reload-plugins` after `cd`.
- Live editing: a skill's `SKILL.md` takes effect immediately; other components (`hooks/`, `.mcp.json`, `agents/`, `output-styles/`) need `/reload-plugins` or restart.
- Stop loading: delete the folder or `claude plugin disable <name>@skills-dir` (no uninstall — nothing was installed).

## Symlink resolution

How a symlink inside a plugin dir is handled when copied to cache depends on where its target resolves:

| Target location                   | Handling                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Within the plugin's own dir       | Preserved as a relative symlink (resolves to copied target)                   |
| Elsewhere in the same marketplace | Dereferenced — target content copied in (meta-plugin can link sibling skills) |
| Outside the marketplace           | Skipped (security)                                                            |

For `--plugin-dir`/local-path installs, only symlinks resolving within the plugin's own dir are preserved; all others skipped. Path traversal (`../shared-utils`) does not work post-install — external files are not copied.

## Node.js package dependencies

Separate from [plugin `dependencies`](#plugin-dependencies) (other plugins) — this is auto-install for a marketplace plugin's OWN `package.json` deps, into the cached copy, so its hooks/MCP servers can load them without a manual step. Runs on fresh install, on update to a new version, and at session start when an enabled plugin isn't cached yet (new machine).

| Lockfile present                            | Command                                          |
| ------------------------------------------- | ------------------------------------------------ |
| `bun.lock` / `bun.lockb`                    | `bun install --frozen-lockfile --ignore-scripts` |
| `npm-shrinkwrap.json` / `package-lock.json` | `npm ci --ignore-scripts`                        |

- Requires BOTH `package.json` and one of the above lockfiles at plugin root; first match wins in the listed order. `yarn.lock`/`pnpm-lock.yaml` are skipped (their resolution-time hooks bypass `--ignore-scripts`) — ship an npm lockfile for widest reach; for an `npm`-source plugin use `npm-shrinkwrap.json` (npm excludes `package-lock.json` from published packages).
- Frozen resolution (fails rather than re-resolve on a `package.json`/lockfile mismatch); no lifecycle scripts (native-module builds download but don't compile); 60 s timeout (a timeout can leave a partial `node_modules`). Not configurable — no setting/env var disables it.
- A failed/timed-out install never blocks the plugin; failure or a skipped yarn/pnpm lockfile logs a warning in `claude --debug` output (silent only when `package.json` has no lockfile at all).
- Fetching an `npm`-source plugin itself runs `npm install` WITH lifecycle scripts first, as a separate step before this `--ignore-scripts` dependency install.
- Deps this can't provide (lifecycle-script builds, Python, Yarn/pnpm-locked) — install from a hook into `${CLAUDE_PLUGIN_DATA}` instead (see the dependency-reinstall pattern under [Path variables](#path-variables)).

## Version resolution

Plugin version = cache key for update detection. Resolved from first set:

1. `version` in the plugin's `plugin.json`
2. `version` in the plugin's marketplace entry
3. git commit SHA of the plugin's source (for `github`/`url`/`git-subdir`/relative-path sources in a git-hosted marketplace) — every commit = new version
4. SHA-256 digest, truncated to 12 chars (for `archive` sources): the entry's `sha256` pin if set, else the digest of the downloaded file
5. `unknown` (for `npm` sources or local dirs not in a git repo)

- Explicit `version` pins: must bump on every release; pushing commits without bumping does nothing (cache kept, `/plugin update` reports already-latest). Avoid setting in BOTH `plugin.json` and marketplace entry — `plugin.json` wins silently. Auto-update is OFF by default for non-Anthropic marketplaces: users pick up a new version by enabling auto-update for that marketplace in `/plugin`, or running `claude plugin update <plugin>` (then `/reload-plugins` to install any newly added deps).
- Release channels: two marketplaces pointing at different `ref`/`sha` of the same repo, assigned to user groups via managed settings; each channel must resolve to a distinct version.

## Plugin hints

Lets a CLI/SDK prompt Claude Code users to install a plugin when the CLI detects it is running inside Claude Code. Only fires for plugins listed in the official `claude-plugins-official` marketplace (curated by Anthropic at its discretion; the in-app community submission form does NOT add a plugin there).

### Mechanism

1. CLI writes the hint tag to stderr on its own line (Claude Code scans both stdout and stderr; stderr recommended to keep it out of shell pipelines). Only Bash/PowerShell tool output triggers the prompt; in hook commands the tag is stripped and ignored.
2. Gate emission on an env var to avoid showing the hint to human users running the CLI directly.
3. Claude Code scans + removes hint lines before output reaches the model (never counted toward tokens), checks the target is an official Anthropic marketplace, not already installed, not prompted before, then shows a one-time prompt naming the emitting command.
4. Yes → plugin installed to user scope. "No, and don't show again" disables all future hint prompts. No-response within 30 s dismisses as No. At most once per plugin and once per session (across all CLIs). Sessions with telemetry disabled never prompt — `DISABLE_TELEMETRY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, or a third-party provider (Amazon Bedrock, Google Cloud Agent Platform) where the automatic telemetry opt-out applies.

### Gate variables

| Variable                    | Set when                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDECODE`                | `1` in every Bash/PowerShell + hook subprocess, all CC versions. Also set in tmux + stdio-MCP subprocesses and IDE integrated terminals (a human may run your CLI there). Widest reach.                  |
| `CLAUDE_CODE_CHILD_SESSION` | `1` only in subprocesses CC itself spawns (tool calls, hooks, statusline). version >= 2.1.172. Avoids most human terminals; long-lived processes (tmux server) capture it. Older sessions miss the hint. |

### Marker format (BREAKING CHANGE — was `CLAUDE_PLUGIN_HINT: name@marketplace`)

Self-closing tag with three required attributes, on its own line:

```
<claude-code-hint v="1" type="plugin" value="example-cli@claude-plugins-official" />
```

| Attribute | Required | Description                                       |
| --------- | -------- | ------------------------------------------------- |
| `v`       | Yes      | Protocol version; `1` is the only supported value |
| `type`    | Yes      | Hint kind; `plugin` is the only supported value   |
| `value`   | Yes      | Plugin identifier in `name@marketplace` form      |

Example in Node.js:

```js
if (process.env.CLAUDECODE) {
  process.stderr.write('<claude-code-hint v="1" type="plugin" value="example-cli@claude-plugins-official" />\n');
}
```

- Attribute values may be double-quoted or unquoted (unquoted cannot contain whitespace); no escape sequences.
- Enforced (else dropped): tag must occupy its own line (leading/trailing whitespace OK; mid-line embedded tag ignored); `value` must reference an Anthropic-controlled marketplace (e.g. `claude-plugins-official`) — hints to other marketplaces silently dropped.
- The hint line is always removed before reaching the model, even for unrecognized `v`/`type`.

## Plugin CLI

Non-interactive plugin management commands.

| Command                     | Syntax                                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin init`               | `claude plugin init <name> [--with <components…>] [--description <text>] [--author <name>] [--author-email <email>] [-f]` | Scaffold at `~/.claude/skills/<name>/`; loads next session as `<name>@skills-dir`. `--with`: `skills agents hooks mcp lsp output-style channel`. `--author`/`--author-email` default to `git config user.name`/`user.email`. Alias `new`. Blocked when `skills-dir` source is in managed `blockedMarketplaces`/excluded by `strictKnownMarketplaces`.                                 |
| `plugin install`            | `claude plugin install <plugin> [--config <key=value>] [-s scope]`                                                        | Install from marketplace; `<plugin>` = `name` or `name@marketplace`; scope `user`/`project`/`local`, default `user`. Resolves + installs declared dependencies. `--config` sets a declared `userConfig` option (repeat the flag for several).                                                                                                                                         |
| `plugin uninstall`          | `claude plugin uninstall <plugin> [--keep-data] [--prune] [-y] [-s scope]`                                                | Remove; data dir deleted from last scope unless `--keep-data`. `--prune` also removes orphaned auto-deps; `-y` skips its confirmation (required when stdin/stdout is not a TTY). Aliases `remove`, `rm`. version >= 2.1.212: the `name@marketplace` form uninstalls only from the named marketplace (earlier versions could match a same-named plugin from a different one).          |
| `plugin prune`              | `claude plugin prune [--dry-run] [-y] [-s scope]`                                                                         | version >= 2.1.121. Remove auto-installed deps no plugin requires; never touches directly-installed. Alias `autoremove`.                                                                                                                                                                                                                                                              |
| `plugin enable`             | `claude plugin enable <plugin> [-s scope]`                                                                                | Enable; enables dependencies transitively (fails if a dep is not installed).                                                                                                                                                                                                                                                                                                          |
| `plugin disable`            | `claude plugin disable [plugin] [-a] [-s scope]`                                                                          | Disable without uninstalling; fails if another enabled plugin depends on target (error gives chained command). `-a`/`--all` disables every enabled plugin and cannot be combined with `--scope`; `[plugin]` is optional only with `--all`.                                                                                                                                            |
| `plugin update`             | `claude plugin update <plugin> [-s scope]`                                                                                | Scope may be `user`/`project`/`local`/`managed`.                                                                                                                                                                                                                                                                                                                                      |
| `plugin list`               | `claude plugin list [--json] [--available]`                                                                               | `--available` needs `--json`. `/plugin list` inline supports `--enabled`/`--disabled`; alias `ls`. `@skills-dir` plugins show in `/plugin` + `claude plugin list` but NOT in inline `/plugin list`; `--plugin-dir`/`--plugin-url` plugins only when the flag precedes the subcommand (`claude --plugin-dir <dir> plugin list`).                                                       |
| `plugin details`            | `claude plugin details <name>`                                                                                            | Component inventory + projected always-on/on-invoke token cost.                                                                                                                                                                                                                                                                                                                       |
| `plugin tag`                | `claude plugin tag [path] [--push] [--dry-run] [-f] [-m <msg>] [--remote <name>]`                                         | Create `{name}--v{version}` release tag; `[path]` defaults to the current dir. `--push` pushes to `origin` (override with `--remote`); on push failure the tag stays local and the command exits nonzero. `-m` sets the annotation message (`%s` = version placeholder).                                                                                                              |
| `plugin validate`           | `claude plugin validate <path> [--strict]`                                                                                | Validate marketplace or plugin JSON; `--strict` = warnings as errors.                                                                                                                                                                                                                                                                                                                 |
| `plugin marketplace add`    | `claude plugin marketplace add <source> [--scope scope] [--sparse <paths…>]`                                              | `<source>` = `owner/repo[@ref]`, git URL (`#ref`), remote `marketplace.json` URL, or local path. `--sparse` limits checkout (monorepos). A URL must include its scheme; version >= 2.1.196 rejects a bare host (e.g. `gitlab.example.com/team/plugins`) as invalid `owner/repo` shorthand instead of misreading it as a GitHub path (which failed at clone time on earlier versions). |
| `plugin marketplace remove` | `claude plugin marketplace remove <name> [--scope scope]`                                                                 | `<name>` is the marketplace `name`, not the add-source. Without `--scope` removes from all scopes; removing last scope uninstalls its plugins. Alias `rm`. Fails for seed-managed (read-only).                                                                                                                                                                                        |
| `plugin marketplace update` | `claude plugin marketplace update [name]`                                                                                 | Refresh from sources; seed-managed entries skipped.                                                                                                                                                                                                                                                                                                                                   |
| `plugin marketplace list`   | `claude plugin marketplace list [--json]`                                                                                 | List configured marketplaces. `--json` entries include `name`, `source`, `installLocation` (local cache path), source-specific fields (`repo`/`url`/`path`), `ref` when pinned.                                                                                                                                                                                                       |

### Scope values

| Scope     | Settings file                 | Description                                                |
| --------- | ----------------------------- | ---------------------------------------------------------- |
| `user`    | `~/.claude/settings.json`     | Default. Personal; across all projects.                    |
| `project` | `.claude/settings.json`       | Team-shared via version control; requires workspace trust. |
| `local`   | `.claude/settings.local.json` | Local only; gitignored.                                    |
| `managed` | managed settings              | Managed plugins (read-only; update only).                  |

### Session flags

- `claude --plugin-dir <path>` — load a plugin dir for this session only (no install). Accepts a `.zip` archive (version >= 2.1.128). When same-named as an installed plugin, the local copy wins for the session (except managed force-enable/disable). Repeat the flag for multiple.
- `claude --plugin-url <url>` — fetch + load a plugin `.zip` from URL for this session only. Repeat the flag, or pass space-separated URLs as one quoted arg. A fetch failure or invalid archive surfaces as a plugin load error; the session still starts, without that plugin.
- `/reload-plugins` reloads plugins, skills, agents, hooks, plugin MCP + LSP servers without restart.

### Env vars

| Variable                                                     | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_PLUGIN_SEED_DIR`                                | Pre-populated read-only plugins dir (mirrors `~/.claude/plugins`: `known_marketplaces.json`, `marketplaces/<name>/`, `cache/<mp>/<plugin>/<version>/`). Layer with `:` (Unix) / `;` (Windows); first match wins. Seed entries take precedence + auto-update disabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `CLAUDE_CODE_PLUGIN_CACHE_DIR`                               | Install target during seed build (install directly into the seed path).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE`             | `1` keeps the stale marketplace clone when `git pull` fails (offline/airgapped) instead of wiping + re-cloning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS`                          | Override the 120 000 ms git clone/pull timeout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GITHUB_TOKEN`/`GH_TOKEN`, `CLAUDE_CODE_PLUGIN_PREFER_HTTPS` | Private-repo marketplace auth. A provider token in the environment does NOT by itself authenticate — it takes effect only through a configured git credential helper (e.g. `gh auth setup-git`, which reads `GH_TOKEN`/`GITHUB_TOKEN`). Manual install/update uses credential helpers + ssh-agent; the background `git pull` DISABLES helpers (SSH keys in ssh-agent still authenticate), then falls back to a full re-clone that does use stored credentials. To authenticate the background pull itself, add a global git URL rewrite scoped to the marketplace repo/org — never to the bare host (GitHub `x-access-token:TOKEN@`, GitLab `oauth2:TOKEN@`, Bitbucket `x-token-auth:TOKEN@`). `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` clones GitHub `owner/repo` shorthand sources over HTTPS instead of the default SSH. |

### Settings keys (in settings.json; details in claude-code-settings-reference.md)

| Key                       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabledPlugins`          | `{ "<plugin>@<marketplace>": true/false }` — explicit enable state per scope; precedence over `defaultEnabled`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `extraKnownMarketplaces`  | Register marketplaces (prompts team on project trust). Does not by itself restrict.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `strictKnownMarketplaces` | Managed-settings allowlist of addable marketplace sources. `undefined` = no limit; `[]` = lockdown; list of `{source…}` / `{hostPattern}` / `{pathPattern}` (regex) = allowed only. Checked before every add/install/update/auto-update. Exact match does not normalize URLs (trailing slash / `.git` suffix / `ssh://` vs `https://` count as different) — prefer `hostPattern` for hosts reachable via multiple URL forms. GitHub entries may use owner-wildcard `{"source":"github","repo":"owner/*"}` to allow every repo under an owner (version >= 2.1.223). Pair with managed `disableSideloadFlags` (rejects the CLI flags that sideload plugins/agents/MCP servers for one run) and `pluginSuggestionMarketplaces` (allowlists whose plugins may appear as contextual install suggestions). |
| `blockedMarketplaces`     | Managed-settings blocklist (same enforcement); blocks `{"source":"skills-dir"}` to disable `plugin init`; also accepts the owner-wildcard `github` form (version >= 2.1.223).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## LSP servers

Component that supplies code-intelligence (completions, diagnostics, hover) to Claude Code's editor integration via `.lsp.json` / `lspServers`. Full schema (required/optional fields, scopes, example, official LSP plugins): see `references/claude-code-plugins-lsp-reference.md`.

## Monitors

Background monitors watch logs/files/commands and deliver each stdout line to Claude as a notification; Claude Code starts each automatically when the plugin is active (`experimental.monitors`; version >= 2.1.105 — see [Version notes](#version-notes)). Same mechanism as the Monitor tool and shares its constraints: run only in interactive CLI sessions, unsandboxed at hook-level trust, skipped on hosts where the Monitor tool is unavailable.

### monitors.json schema

Array of entries; declare inline via `experimental.monitors` (array) or load from a non-default path (relative path string).

| Field         | Required | Description                                                                                                                                                                |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | Yes      | Identifier unique within the plugin; prevents duplicate processes on plugin reload or repeat skill invocation                                                              |
| `command`     | Yes      | Shell command run as a persistent background process in the session working dir                                                                                            |
| `description` | Yes      | Short summary; shown in the task panel and notification summaries                                                                                                          |
| `when`        | No       | `"always"` (default) — starts at session start and on plugin reload. `"on-skill-invoke:<skill-name>"` — starts the first time the named skill in this plugin is dispatched |

- `command` substitutes `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`, any `${ENV_VAR}`. Prefix with `cd "${CLAUDE_PLUGIN_ROOT}" &&` for a script that must run from the plugin's own dir.
- version >= 2.1.207: `command` may NOT reference `${user_config.*}` — it runs through a shell, so the monitor is rejected with an error instead. Monitor processes also receive no `CLAUDE_PLUGIN_OPTION_<KEY>` env vars; have the script read the value from a config file it owns. Earlier versions substituted.
- Disabling a plugin mid-session does not stop monitors already running; they stop when the session ends.

## Version notes

- version >= 2.1.105: plugin background monitors.
- version >= 2.1.110: dependency version constraints.
- version >= 2.1.121: `claude plugin prune`.
- version >= 2.1.128: `--plugin-dir` accepts a `.zip` archive.
- version >= 2.1.140: ignored-folder flagged in `/doctor` when both default folder + manifest key exist.
- version >= 2.1.142: single-`SKILL.md`-at-root plugin auto-loads as one skill.
- version >= 2.1.143: `displayName` recognized; enable/disable dependency cascade.
- version >= 2.1.152: marketplace plugin-entry `relevance` field.
- version >= 2.1.154: `defaultEnabled`.
- version >= 2.1.172: `CLAUDE_CODE_CHILD_SESSION` + the `<claude-code-hint />` tag.
- version >= 2.1.193: marketplace `renames` field (former-name → current-name/`null` migration map).
- version >= 2.1.196: local-folder git marketplaces resolve dependency tags; `plugin marketplace add` rejects schemeless-host sources; marketplace `validate` per-entry pass covers root-`.`-source entries and non-`.claude-plugin`-nested `marketplace.json`.
- version >= 2.1.205: reserved marketplace names re-checked on every marketplace load, not only on add; `first-party-plugins`/`healthcare` added to the reserved list.
- version >= 2.1.207: shell-run fields (shell-form hook commands, monitor commands, MCP `headersHelper`) REJECT `${user_config.*}` instead of substituting; `pluginConfigs` no longer read from project/local settings.
- version >= 2.1.212: `claude plugin uninstall <name>@<marketplace>` removes only that marketplace's copy.
- version >= 2.1.218: boolean frontmatter in plugin skills/commands also accepts `yes`/`no`/`on`/`off`/`1`/`0` (any casing).
- version >= 2.1.221: `skills` path field accepts bare `.` (same as `./`); marketplace `validate` adds Claude-Desktop-compat name warnings.
- version >= 2.1.222: `metadata` plugin.json field recognized (ignored at runtime; non-object value warns instead of failing); earlier versions treat the key as unrecognized.
- version >= 2.1.223: owner-wildcard (`owner/*`) `github` entries in `strictKnownMarketplaces`/`blockedMarketplaces`.
- version >= 2.1.224: `archive` marketplace plugin-source type (zip over HTTPS, `sha256`-pinnable).
- Version lives ONLY in `.claude-plugin/plugin.json` (repo convention). Resolution order: plugin.json → marketplace entry → git SHA → archive digest → `unknown` (npm/non-git).
- Omitting `version`: git commit SHA used; updates on every new commit. Setting it: updates only on version change; bump every release.
- Orphaned plugin version directories cleaned up automatically ~14 days after update/uninstall.
