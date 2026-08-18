# Claude Code Plugins — Marketplace Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (Plugin marketplaces, Plugin dependencies, Plugin hints), verified 2026-08-18.
> Split out of claude-code-plugins-reference.md to keep that file under its line budget;
> linked from that file's "## Marketplace" pointer.

## marketplace.json schema

### Required top-level fields

| Field     | Type   | Description                                                                                                                                               |
| --------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`    | string | Marketplace identifier (kebab-case); public-facing. One marketplace per name per user (re-adding same name replaces). Reserved names blocked (see below). |
| `owner`   | object | `{ "name": "…" }` required; `"email"` and `"url"` optional                                                                                                |
| `plugins` | array  | List of plugin entries                                                                                                                                    |

Reserved marketplace names (Anthropic official; cannot be used by third parties): `claude-code-marketplace`, `claude-code-plugins`, `claude-plugins-official`, `claude-plugins-community`, `claude-community`, `anthropic-marketplace`, `anthropic-plugins`, `agent-skills`, `anthropic-agent-skills`, `knowledge-work-plugins`, `life-sciences`, `claude-for-legal`, `claude-for-financial-services`, `financial-services-plugins`, `first-party-plugins`, `healthcare`. Impersonating names (e.g. `official-claude-plugins`) also blocked. Checked on every marketplace load, not only on add — version >= 2.1.205: a marketplace already registered under a name that later became reserved stops loading (`registered from an untrusted source`); remove + re-add under a different name (earlier versions kept it loading). Anthropic's own: `claude-plugins-official` (curated by Anthropic; auto-registered on first interactive launch, non-interactive scripts add it explicitly via `claude plugin marketplace add anthropics/claude-plugins-official`) and `claude-community` (public community catalog; add source `anthropics/claude-plugins-community`, install as `<plugin>@claude-community`).

### Optional top-level fields

| Field                                 | Type   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`                         | string | Brief marketplace description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `version`                             | string | Marketplace manifest version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `$schema`                             | string | JSON Schema URL for editor validation; ignored at load time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `metadata.pluginRoot`                 | string | Base dir prepended to relative plugin source paths (e.g. `"./plugins"` lets you write `"source": "formatter"` for `"./plugins/formatter"`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `allowCrossMarketplaceDependenciesOn` | array  | Other marketplace names plugins in this marketplace may depend on (root marketplace's allowlist only is consulted)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `renames`                             | object | version >= 2.1.193. Map a former plugin `name` → its current name, or `null` if removed; lets existing users auto-migrate instead of hitting `plugin-not-found`. Append-only (never edit a prior entry, add a new one); chains are followed; `claude plugin validate .` rejects cycles or chains that don't terminate at `null`/a listed name. Rename notice rewrites `enabledPlugins`/`pluginConfigs` keys once; renamed remote-source (`github`/`npm`) plugins need one `/plugin install` to fetch under the new name (`plugin-cache-miss` until then). Managed/policy-scoped entries can't self-rewrite — notice recurs until an admin updates them. |

`description` and `version` are also accepted under `metadata` for backward compatibility.

### Plugin entry fields

An entry may carry ANY field from the [plugin.json schema](claude-code-plugins-reference.md#standard-metadata-fields) plus these marketplace-specific fields:

**Standard metadata fields:**

| Field            | Type           | Description                                                                                                                                                                                                                        |
| ---------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | string         | Plugin identifier (kebab-case). Required.                                                                                                                                                                                          |
| `source`         | string\|object | Where to fetch the plugin. Required. See source types below.                                                                                                                                                                       |
| `displayName`    | string         | Human-readable name shown in UI. Falls back to `name`. May contain spaces/any casing. Not used for namespacing or lookup.                                                                                                          |
| `description`    | string         | Brief plugin description                                                                                                                                                                                                           |
| `version`        | string         | Plugin version pin. If set here or in `plugin.json`, plugin is pinned and users only get updates on change. `command` sources are never pinned by this field.                                                                      |
| `author`         | object         | `name` required; `email` and `url` optional                                                                                                                                                                                        |
| `homepage`       | string         | Plugin homepage URL                                                                                                                                                                                                                |
| `repository`     | string         | Source code repository URL                                                                                                                                                                                                         |
| `license`        | string         | SPDX license identifier                                                                                                                                                                                                            |
| `keywords`       | array          | Tags for discovery                                                                                                                                                                                                                 |
| `metadata`       | object         | Free-form object for your own fields (entitlement, catalog data). Claude Code doesn't read it. version < 2.1.222: `claude plugin validate` reported it as unrecognized.                                                            |
| `category`       | string         | Single category string                                                                                                                                                                                                             |
| `tags`           | array          | Short keyword strings                                                                                                                                                                                                              |
| `strict`         | boolean        | Default `true`. `true` = `plugin.json` is authority, marketplace entry SUPPLEMENTS (both merged). `false` = marketplace entry is the WHOLE definition; if `plugin.json` also declares components → conflict, plugin fails to load. |
| `relevance`      | object         | version >= 2.1.152. Signals telling Claude Code when to suggest this plugin to users; effective only for marketplaces an admin allowlists in managed settings.                                                                     |
| `defaultEnabled` | boolean        | version >= 2.1.154. Whether the plugin is enabled after install (default `true`). Set `false` to install disabled until user opts in. Takes precedence over same field in `plugin.json`.                                           |

**Component configuration fields:**

| Field        | Type           | Description                                                    |
| ------------ | -------------- | -------------------------------------------------------------- |
| `skills`     | string\|array  | Custom paths to skill directories containing `<name>/SKILL.md` |
| `commands`   | string\|array  | Custom paths to flat `.md` skill files or directories          |
| `agents`     | string\|array  | Custom paths to agent files                                    |
| `hooks`      | string\|object | Custom hooks configuration or path to hooks file               |
| `mcpServers` | string\|object | MCP server configurations or path to MCP config                |
| `lspServers` | string\|object | LSP server configurations or path to LSP config                |

Do NOT add `version` to marketplace entries when `plugin.json` already carries it — `plugin.json` wins silently and a stale value can mask the marketplace value. (Repo convention: keep version in `plugin.json` only.)

### Plugin source types

| Source form   | Fields                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relative path | `string` starting with `./`        | Local dir within the marketplace repo. Resolved relative to the **marketplace root** (dir containing `.claude-plugin/`), NOT the `.claude-plugin/` dir. No `../`. Only resolves when the marketplace is added via git, not via a direct URL to `marketplace.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `github`      | `repo`, `ref?`, `sha?`             | object; `repo` = GitHub `owner/repo`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `url`         | `url`, `ref?`, `sha?`              | object; full git URL (`https://` or `git@`); `.git` suffix optional (Azure DevOps / CodeCommit work)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `git-subdir`  | `url`, `path`, `ref?`, `sha?`      | object; subdir within a git repo (sparse partial clone). `url` also accepts `owner/repo` shorthand or SSH URL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm`         | `package`, `version?`, `registry?` | object; installed via `npm install`; `registry` defaults to system npm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `archive`     | `url`, `sha256?`                   | object; zip downloaded over HTTPS — installs without git/npm on the user's machine. `.claude-plugin/` must sit at the archive top or one folder down (Claude Code doesn't look deeper). Rejects `http://` and loopback/link-local/cloud-metadata hosts, on every redirect hop too; refuses archives > 256 MiB. `sha256` (64 hex chars) pins the exact file — mismatch refuses install with `Plugin archive integrity check failed`. `sha256` also serves as plugin version when neither `plugin.json` nor marketplace entry declares one. Headers from a `headers`-bearing `extraKnownMarketplaces` URL source forward to an archive download only when it shares the marketplace URL's origin; dropped across any redirect that leaves that origin. version >= 2.1.224 — v2.1.120-2.1.223 the install fails with `This plugin uses a source type your Claude Code version does not support. Update Claude Code and try again.`; earlier versions fail to load the whole marketplace.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `command`     | `command`, `timeout?`, `mode?`     | object; version >= 2.1.229. Runs a local shell command that prints the plugin directory's absolute path (stdout, one line, exit 0); re-run once per session in the background to pick up changes. Command runs via `sh` on macOS/Linux or `cmd.exe` on Windows, from the user's home directory. `command` must be printable ASCII ≤500 chars with no runs of ≥4 spaces. `timeout` = seconds (default 60, max 600). `mode`: `"copy"` (default, copies dir into cache, hashes for version, ≤256 MiB/20000 entries) or `"link"` (uses dir in place; no copy/hash/size limit; top-level symlinks must not leave the dir; skips node_modules install; not supported on Windows; version derived from the printed directory's real path and its top-level entries, not file contents — print a different path to signal new content; in a session started in the printed directory or anywhere below it, the plugin does not load). Refused printed path conditions: no plugin content at top level (no `.claude-plugin/`, `skills/`, `commands/`, `agents/`, `hooks/` dir); directory is Claude Code's start dir or a parent; UNC path on Windows. Command re-runs: on every install/update; once per session (skipped when `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set); on cache miss at startup or `/reload-plugins`. Changed output installs as new version and hot-reloads in the running session; if reloading would invalidate the session's prompt cache, Claude Code instead prompts the user to run `/reload-plugins` (which warns about the cache cost and applies when rerun with `--force`). Users must explicitly accept the command string before it runs. v2.1.120-2.1.228: install fails with `This plugin uses a source type your Claude Code version does not support. Update Claude Code and try again.`; earlier versions fail to load the whole marketplace. |

- For git sources (`github`/`url`/`git-subdir`), when both `ref` and `sha` are set, `sha` is the effective pin. `sha` = full 40-char commit SHA. On hosts that support fetching a commit by SHA (GitHub, GitLab, Bitbucket) install succeeds even if the `ref` branch/tag was deleted upstream, as long as the commit is reachable; on servers that do not (e.g. AWS CodeCommit) the `ref` must still exist and the pinned commit be reachable from it.
- Plugin source (per-entry `source`) ≠ marketplace source (where `marketplace.json` itself is fetched; set via `plugin marketplace add` / `extraKnownMarketplaces`; supports `ref` but not `sha`).
- Marketplace-root source (`source: "./"`) with shared `skills/`: list specific subdirs in `skills` so each entry loads only its own (the listed paths are the complete set; listing `./skills/` or the plugin root keeps the full scan; if none of the listed paths exist, the default scan runs).
- Admins can block command sources org-wide with managed setting `disableCommandPluginSources`. When `allowManagedHooksOnly` is set, command sources are blocked by default.

## Plugin dependencies

Declared in `dependencies` array of `plugin.json`. Each entry: bare string (plugin name, tracks latest) or object:

| Field         | Type   | Description                                                                                                                                       |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | string | Plugin name. Resolves within the same marketplace as the declaring plugin. Required.                                                              |
| `version`     | string | semver range (`~2.1.0`, `^2.0`, `>=1.4`, `=2.1.0`). Pre-release excluded unless range opts in with pre-release suffix like `^2.0.0-0`.            |
| `marketplace` | string | Different marketplace to resolve in. Cross-marketplace dependencies are blocked unless target is listed in `allowCrossMarketplaceDependenciesOn`. |

A plugin with only `name` + `dependencies` (no skills/agents/hooks) acts as an installable bundle. Missing dependencies are re-resolved on `/reload-plugins`, auto-update, or re-running `claude plugin install`. Dependencies from an unadded marketplace are left unresolved.

### Version tagging convention

For semver-range constraints to work, the dependency's repository must have tags in the form `{plugin-name}--v{version}` (e.g. `secrets-vault--v2.1.0`). Create with `claude plugin tag --push` from the plugin directory; `--dry-run` previews without creating. The tag name is derived from `plugin.json` and the marketplace entry; refuses if the tag exists, working tree is dirty, or versions are mismatched. Cache directory for a tag-resolved install includes a 12-character commit-SHA suffix; force-moving a tag to a different commit gets a fresh cache directory. For a relative-path plugin with no matching tag, Claude Code installs the marketplace's current copy and checks the constraint at load time; version >= 2.1.196 required for tag lookup from a local-folder marketplace. For `npm`/`archive`/`command` sources, the range is checked at load time but does not control which version is fetched; for `command`-source deps specifically, Claude Code checks the version in the dep's `plugin.json` and ignores the content-hash suffix — a dep with no `plugin.json` version satisfies no constraint (set one before constraining it). Claude Code never auto-installs a `command`-sourced dependency — users install it first.

### Constraint resolution

When multiple installed plugins constrain the same dependency, Claude Code intersects their ranges and resolves to the highest git tag satisfying all of them. If no tag satisfies all ranges, auto-update skips that dependency and lists the skip in the `/plugin` Errors tab, naming the constraining plugin.

| Plugin A requires | Plugin B requires | Result                                                                    |
| ----------------- | ----------------- | ------------------------------------------------------------------------- |
| `^2.0`            | `>=2.1`           | One install at highest `2.x` tag at or above `2.1.0`. Both load.          |
| `~2.1`            | `~3.0`            | Plugin B install fails with `range-conflict`. A and dependency unchanged. |
| `=2.1.0`          | none              | Stays at `2.1.0`; auto-update skips newer versions while A is installed.  |

### Enable/disable with dependencies

Enabling a plugin also enables all its dependencies (recursively) at the same scope, writing explicit `true` even when a dependency sets `defaultEnabled: false`. Enabling fails if a dependency is not installed, is blocked by policy, or is set to `false` at a higher-precedence scope.

Disabling a plugin is refused if another enabled plugin still depends on it. The error names the dependents and provides a chained command to disable them in order.

When the last plugin that constrains a dependency is uninstalled, the dependency is no longer held and resumes tracking its marketplace entry on the next update.

### Pruning orphaned auto-installed dependencies

Auto-installed dependencies remain on disk after the plugins that installed them are uninstalled. To remove them:

```bash
claude plugin prune                        # list and remove orphaned auto-installed deps (with confirmation)
claude plugin prune --dry-run              # preview only
claude plugin prune --scope project        # target a specific scope
claude plugin uninstall < plugin > --prune # uninstall plugin then prune orphans it leaves
```

`-y` skips confirmation; without a TTY, prune lists orphans and exits unless `-y` is passed.

### Dependency error codes

| Error                            | Cause                                                                                                          | Resolution                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `dependency-unsatisfied`         | Dependency not installed or disabled                                                                           | `claude plugin install <dep>@<marketplace>`; enable if needed                                      |
| `range-conflict`                 | No version satisfies all ranges, or a range is invalid semver, or combined ranges are too complex to intersect | Uninstall/update a conflicting plugin, fix invalid version strings, or simplify long `\|\|` chains |
| `dependency-version-unsatisfied` | Installed version outside declared range                                                                       | Re-run `claude plugin install <dep>@<marketplace>`                                                 |
| `no-matching-tag`                | Dependency repo has no `{name}--v*` tag satisfying the range                                                   | Tag a release or relax the range                                                                   |

## Validate marketplace

```bash
claude plugin validate .                   # validates marketplace.json: schema, dup names, source traversal, version mismatches
claude plugin validate ./plugins/my-plugin # validates a plugin: plugin.json + skill/agent/command/hook files
```

- For each entry whose `source` is a local path, `validate .` also validates that plugin's own `plugin.json` and warns on a `version` mismatch; problems are prefixed `plugins[N] plugin.json →`. Non-blocking warnings: no plugins defined, no marketplace `description`, plugin `name` not kebab-case (Claude Code loads other forms, but the claude.ai marketplace sync rejects them).
- version >= 2.1.196: the per-entry pass additionally covers entries whose `source` is `.`, runs when `marketplace.json` sits outside a `.claude-plugin/` dir (resolving against that file's own directory), and reports each entry's problems even when another part of the file has schema errors. Earlier versions skip marketplace-root plugins and only descend from `.claude-plugin/marketplace.json`.
- version >= 2.1.221: adds non-blocking warnings for Claude Desktop's managed-marketplace sync (which Claude Code itself ignores): a marketplace named `org`/`org-provisioned`/`unknown` (any casing) is rejected outright by that sync; a marketplace/plugin `name` over 128 chars or outside `[A-Za-z0-9._-]`/not starting with a letter-or-digit is rejected (marketplace) or silently dropped (plugin) by it. Earlier versions don't run these checks.

## Managed marketplace restrictions

`strictKnownMarketplaces` in managed settings restricts which marketplaces users can add. Supported source types for entries:

| Entry source  | Fields         | Notes                                                                                      |
| ------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `github`      | `repo`, `ref?` | Exact match for single-repo entries; `repo: "owner/*"` owner-wildcard (version >= 2.1.223) |
| `url`         | `url`          | Full URL, exact match (no `.git`/trailing-slash normalization)                             |
| `hostPattern` | `hostPattern`  | Regex matched against marketplace host. Use for GHES/self-hosted GitLab.                   |
| `pathPattern` | `pathPattern`  | Regex matched against filesystem path. Use `".*"` to allow any local path.                 |

- `blockedMarketplaces`: deny-list; same source types. version >= 2.1.232: when user adds an `https://` URL that Claude Code clones (bare github.com/gitlab.com URL), Claude Code also checks it against `url` entries in `blockedMarketplaces`; comparison ignores the `.git` suffix and any `#ref` the user appends.
- `strictKnownMarketplaces` matches the marketplace source, not entries inside it — a `command`-sourced plugin from an allowed marketplace still installs. To block command sources too, set `disableCommandPluginSources`.
- Pair `strictKnownMarketplaces` with `disableSideloadFlags` to also reject `--add-dir`/`--mcp`/`--agent` CLI flags.
- `pluginSuggestionMarketplaces`: allowlist for which marketplaces' plugins appear as contextual install suggestions.
- Restrictions checked before any network/filesystem op: on marketplace add and on plugin install/update/refresh/auto-update. A marketplace added before policy was configured and whose source no longer matches is blocked.

## Environment variables (marketplace-related)

| Variable                                         | Purpose                                                                                                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_PLUGIN_SEED_DIR`                    | Pre-populated plugins dir for containers/CI. Colon-separated (Unix) or semicolon-separated (Windows) for multiple dirs. Seed entries take precedence; auto-updates disabled for seed marketplaces (read-only). |
| `CLAUDE_CODE_PLUGIN_CACHE_DIR`                   | Override plugin cache dir (use at image build time to install directly into seed location).                                                                                                                    |
| `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE` | Set to `1` to keep existing marketplace clone when background pull fails (skip re-clone). Use for private repos / offline.                                                                                     |
| `CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS`              | Milliseconds for git clone/pull operations (default 120000 = 120 s). Increase for large repos or slow networks.                                                                                                |
| `CLAUDE_CODE_PLUGIN_PREFER_HTTPS`                | Set to `1` to clone GitHub `owner/repo` shorthand sources over HTTPS instead of SSH.                                                                                                                           |

## Plugin hints (CLI-to-plugin discovery)

A CLI/SDK running inside Claude Code can emit a hint tag to stderr to prompt installation of its companion plugin from the official Anthropic marketplace.

```
<claude-code-hint v="1" type="plugin" value="<plugin-name>@claude-plugins-official" />
```

Hint tag attributes:

| Attribute | Required | Description                                        |
| --------- | -------- | -------------------------------------------------- |
| `v`       | Yes      | Protocol version. `1` is the only supported value. |
| `type`    | Yes      | Hint kind. `plugin` is the only supported value.   |
| `value`   | Yes      | Plugin identifier in `name@marketplace` form.      |

Attribute values may be double-quoted or unquoted (unquoted values cannot contain whitespace). Escape sequences are not supported.

Enforced requirements (hint dropped silently if either fails):

- **Own line**: tag must occupy its own line; a tag embedded mid-line is ignored. Leading and trailing whitespace on the line is allowed.
- **Official marketplace**: `value` must reference a plugin in an Anthropic-controlled marketplace (e.g. `claude-plugins-official`); hints targeting other marketplaces are silently dropped. Getting listed in `claude-plugins-official` is not self-service — in-app submission forms add to the community marketplace, not the official one; contact an Anthropic partner contact to coordinate an official-marketplace listing.

Claude Code strips the tag before output reaches the model (even for unrecognized versions/types — never counted against token usage); shows a one-time install prompt naming the command that emitted it.

Recommended (not enforced — Claude Code cannot observe these):

- Gate on `CLAUDECODE` (every CC version, widest reach) or `CLAUDE_CODE_CHILD_SESSION` (version >= 2.1.172; set only in subprocesses CC spawns — tool calls, hook commands, status line commands — so the tag normally stays out of human terminals; long-lived processes like a tmux server started inside a session capture the variable, so shells later launched from it still see the raw tag).
- Write the tag to **stderr**. Claude Code also scans stdout, but stderr keeps the tag out of shell pipelines.

Additional behavior:

- In hook commands the hint tag is stripped and ignored (no prompt shown).
- Claude Code never installs automatically; user always confirms.
- Only Bash and PowerShell tool output triggers the install prompt (not hook stderr).

Prompt frequency limits:

- **Once per plugin**: after the prompt is shown (any answer), Claude Code records it and never prompts for that plugin again.
- **Once per session**: at most one hint prompt per Claude Code session across all CLIs.
- **30-second timeout**: if the user doesn't respond, the prompt is dismissed as No.
- **Telemetry opt-outs**: sessions with `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set, and sessions on third-party providers (Amazon Bedrock, Google Cloud Agent Platform), never show hint prompts.
- Selecting "No, and don't show plugin installation hints again" disables all future hint prompts for that user.

## CLI commands

```bash
# Marketplace management
claude plugin marketplace add <source> [--scope user|project|local] [--sparse <paths...>]
claude plugin marketplace list [--json]          # --json: name, source, installLocation, source-specific fields (repo/url/path), ref when pinned
claude plugin marketplace remove <name> [--scope ...]
claude plugin marketplace update [name]

# Plugin management
claude plugin install <plugin>@<marketplace>
claude plugin update <plugin>@<marketplace>
claude plugin uninstall <plugin>@<marketplace> [--prune]  # --prune removes orphaned auto-installed deps
claude plugin prune [--dry-run] [--scope ...] [-y]        # remove orphaned auto-installed deps

# Version tagging (for semver constraint resolution)
claude plugin tag [--push] [--remote <remote>] [--dry-run]  # tags {name}--v{version}, optionally pushes
```

- `marketplace add`: version >= 2.1.196: a host without scheme (e.g. `gitlab.example.com/team/plugins`) is rejected as invalid; add `https://` or `./` prefix.
- `marketplace remove` without `--scope` removes from ALL editable scopes and uninstalls plugins from it.
- `marketplace update` against a seed-managed marketplace fails (read-only); skipped when updating all.
- `plugin install --yes`: accepts command-source command string non-interactively.
