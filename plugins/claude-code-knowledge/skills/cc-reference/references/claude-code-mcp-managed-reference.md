# Claude Code MCP — Managed / Enterprise Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (Managed MCP), verified 2026-08-31.
> Apply when deploying or troubleshooting enterprise MCP restrictions (`managed-mcp.json`,
> allowlists/denylists). See `claude-code-mcp-reference.md` for general MCP config/auth/naming.

- Scope: these restrictions cover only servers Claude Code loads itself, including claude.ai
  connectors it fetches. Connectors the desktop app delivers to its own local and SSH sessions
  arrive in-process and are governed by claude.ai organization settings instead — no
  `managed-mcp.json`/allowlist/denylist reaches them.

## Choose a pattern

| Pattern             | Effect                                                                                                                                                                 | Configure                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Disable MCP         | No servers load, apart from in-process servers the app that started the session registers (VS Code extension's own server, desktop-app-delivered local/SSH connectors) | `managed-mcp.json` with an empty server map              |
| Fixed deployment    | Every user gets the same servers, cannot add others                                                                                                                    | `managed-mcp.json` with the servers you want             |
| Approved catalog    | Users add from a published approved list; anything else blocked                                                                                                        | `allowedMcpServers` + `allowManagedMcpServersOnly: true` |
| Plugin servers only | Servers may come only from plugins; users cannot add their own                                                                                                         | `strictPluginOnlyCustomization` with `mcp` in the list   |
| Soft allowlist      | Allowlist users can broaden in their own settings                                                                                                                      | `allowedMcpServers` without `allowManagedMcpServersOnly` |
| Denylist only       | Block known-bad servers, allow everything else                                                                                                                         | `deniedMcpServers`                                       |
| No restrictions     | Users add anything                                                                                                                                                     | Deploy no managed MCP configuration                      |

- No built-in browsable server registry exists. For the approved-catalog pattern, publish the approved list plus its `claude mcp add` commands (e.g. internal wiki), or ship the servers as plugins via a managed plugin marketplace so users install them from `/plugin`.

## `managed-mcp.json` — exclusive control

Deploy this file to give the system exclusive control over which servers load. Users cannot add servers while this file is active.

```json
{
  "mcpServers": {
    "shared-tool": {
      "type": "http",
      "url": "https://internal.example.com/mcp"
    }
  }
}
```

- When present, ONLY these servers load — plugin-provided servers and (by default) claude.ai connectors Claude Code fetches itself are suppressed. In-process servers the app that started the session registers still load — e.g. the VS Code extension's own server, or connectors the desktop app delivers to its local/SSH sessions (those are governed by claude.ai organization settings instead, not by this file).
- `--mcp-config` interaction:
  - On a workstation: Claude Code exits at startup with `You cannot dynamically configure MCP servers when an enterprise MCP config is present`.
  - In cloud sessions (which receive claude.ai connectors and server-delivered servers via `--mcp-config`): Claude Code starts with managed servers only. Nothing in the session tells the user which servers were left out; suppressed servers are named in a warning on stderr, recorded by a self-hosted runner at `debug` log level. version >= 2.1.229. Before 2.1.229, cloud sessions also exited with the workstation error.
  - `--strict-mcp-config` always exits at startup on both workstations and cloud sessions (that flag asks to replace the managed set).
- Exclusive control is not the last word: `allowedMcpServers`/`deniedMcpServers` apply to managed servers too, so a managed server that fails them does not load. A user's own `deniedMcpServers` merges in from their settings, so a user can block a managed server for themselves.
- Standalone file; cannot be delivered via server-managed settings. Deploy via MDM/GPO/Intune/fleet tooling (any admin-priv write).

| Platform  | Path                                                       |
| --------- | ---------------------------------------------------------- |
| macOS     | `/Library/Application Support/ClaudeCode/managed-mcp.json` |
| Linux/WSL | `/etc/claude-code/managed-mcp.json`                        |
| Windows   | `C:\Program Files\ClaudeCode\managed-mcp.json`             |

Validate deployment on a managed machine:

1. `claude mcp list` shows only servers in `managed-mcp.json` — if a user's own servers appear, the file isn't being read; check the path and permissions.
2. `claude mcp add --transport http test https://example.com/mcp` fails with `Cannot add MCP server: enterprise MCP configuration is active and has exclusive control over MCP servers` (URL need not be real; policy check fires before contacting it).

- Deploy empty `{ "mcpServers": {} }` to disable MCP entirely, apart from in-process servers the app that started the session registers (VS Code extension's own server, desktop-app-delivered local/SSH connectors); a server a new policy blocks silently disappears from `/mcp`/`claude mcp list` — no warning shown.
- Do not store credentials in `env` blocks — readable by any user; use `${VAR}` expansion, OAuth, or `headersHelper` instead.
- Plugin-servers-only pattern (no managed-mcp.json): `strictPluginOnlyCustomization` with `mcp` in its list — servers may come only from plugins; users cannot add their own.

## Allowlists and denylists

Filter which already-configured servers may load. NOT a registry — a server must first be added by a user, a plugin, or `managed-mcp.json` before either list applies to it; to deploy servers to users, use `managed-mcp.json`.

- Both lists may live in any settings file and entries from every source merge. For enforcement, set them in a managed source: server-managed settings, `managed-settings.json`, an MDM-deployed plist, or an HKLM registry key.
- Both lists also filter servers passed with `--mcp-config`, other than in-process `type: "sdk"` entries (registered by the app that started the session — these skip both lists entirely). `--strict-mcp-config` limits which configuration files load and does NOT bypass either list.
- Entry that fails schema validation: see settings → "Invalid entries in managed settings".

Example (managed settings):

```json
{
  "allowedMcpServers": [{ "serverUrl": "https://mcp.example.com/*" }, { "serverName": "github" }, { "serverCommand": ["npx", "-y", "approved-package"] }],
  "deniedMcpServers": [{ "serverUrl": "https://staging.example.com/*" }],
  "allowManagedMcpServersOnly": true
}
```

| Field           | Type          | Matches                                                                                                                                                                                                                      |
| --------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverUrl`     | string (glob) | HTTP/SSE server URL; `*` wildcard anywhere                                                                                                                                                                                   |
| `serverName`    | string        | User-assigned label; exact match, no wildcards. NOT a security control — the user picks any name, and for a claude.ai connector it is the claude.ai display name, which can change. Enforce with `serverCommand`/`serverUrl` |
| `serverCommand` | string[]      | Stdio command + args; exact match, every argument                                                                                                                                                                            |

`allowedMcpServers` unset vs empty:

| Setting             | Unset (default) | Empty `[]`   | Populated             |
| ------------------- | --------------- | ------------ | --------------------- |
| `allowedMcpServers` | All allowed     | None allowed | Only matching allowed |
| `deniedMcpServers`  | None blocked    | None blocked | Matching blocked      |

`serverName` validation differs by list:

- `allowedMcpServers`: limited to letters/numbers/`-`/`_`. Use `serverUrl` to allowlist a claude.ai connector.
- `deniedMcpServers`: accepts any non-empty string — block a claude.ai connector by display name, e.g. `{ "serverName": "claude.ai Slack" }`. version >= 2.1.182. Prefer `serverUrl` to be robust to renames /
  <!-- markdownlint-disable-next-line MD038 -- the code span deliberately shows the real UI suffix format: a SPACE before the parenthesis, e.g. "Slack (2)" -->
  ` (N)` suffix collisions.

## How a server is evaluated

Before loading a server (including ones from `managed-mcp.json`), three checks run in order.
In-process `type: "sdk"` servers — registered by the app that started the session (e.g. VS
Code extension, desktop app's local/SSH sessions) — skip all three checks.

1. **Merge the lists.** Allowlist and denylist entries from all settings sources combine. When `allowManagedMcpServersOnly: true`, only the managed allowlist is kept; denylist always merges from all sources.
2. **Check the denylist.** Any match → blocked; nothing overrides.
3. **Check the allowlist.** If `allowedMcpServers` not set anywhere → all remaining load. If set, per server type:

| Server type          | Allowed when it matches                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Remote (HTTP or SSE) | A `serverUrl` entry. A `serverName` match counts only when the allowlist contains no `serverUrl` entries         |
| Stdio                | A `serverCommand` entry. A `serverName` match counts only when the allowlist contains no `serverCommand` entries |

- Built-in servers — Claude in Chrome, the `ide` server Claude Code connects to in a running VS Code or JetBrains IDE, and servers the CLI itself configures — skip this allowlist check.

Three matching rules apply:

- **Commands match exactly.** Every argument, in order — `["npx", "-y", "server"]` does not match `["npx", "server"]`.
- **`serverCommand` and `serverUrl` values expand before matching.** Both the policy entry and the server's configured value expand via `${VAR}`/`${VAR:-default}`. `serverName` matches literally and never expands.
- **URLs support `*` wildcards** anywhere in the pattern. Hostname matching is case-insensitive; paths are case-sensitive.

- Consequence: once the allowlist holds both a `serverUrl` and a `serverCommand` entry, a `serverName` entry in it can never match anything — both transport types already have stricter entries.

## URL wildcard matching rules

| Pattern                     | Allows                                                     |
| --------------------------- | ---------------------------------------------------------- |
| `https://mcp.example.com/*` | All paths on that domain                                   |
| `https://mcp.example.com`   | Also all paths on that domain (no path pattern = any path) |
| `https://*.example.com/*`   | Any subdomain of example.com                               |
| `http://localhost:*/*`      | Any port on localhost                                      |
| `*://mcp.example.com/*`     | Any scheme to that domain                                  |

- Hostname matching: case-insensitive, trailing FQDN dot ignored.
- Path matching: case-sensitive.
- Command matching: exact array comparison including every argument and order.
- `serverCommand` and `serverUrl` values expand before matching: both the policy entry and the server's configured value go through `${VAR}` / `${VAR:-default}` expansion as in `.mcp.json`, so an entry written `["${HOME}/bin/server"]` matches a config using either the same reference or the expanded path. On Windows reference a variable that is set there, e.g. `${USERPROFILE}` instead of `${HOME}`. `serverName` matches literally and never expands.
- version >= 2.1.219: the two sides expand from different environments — the server's configured value still reads Claude Code's live process environment, but a policy entry reads a pinned environment, so a variable set by a project/user settings file cannot change what an allowlist/denylist entry means. Before 2.1.219, both sides expanded from the same live process environment (including variables set by settings files).

  | Entry list          | Expands from                                                                                                                                                                      | Expansion that changes URL scheme/host/path scope |
  | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
  | `allowedMcpServers` | The environment Claude Code started with, plus `env` values from managed settings                                                                                                 | Claude Code ignores the entry                     |
  | `deniedMcpServers`  | Same, plus: a variable with no startup value and no `:-default` fills from settings files outside the repo (user/managed settings) — this only ever widens what the entry matches | Entry still matches                               |

- A policy entry still depends on the launching shell's value for any variable it references — use literal URLs and commands for entries you rely on for enforcement.

## `allowManagedMcpServersOnly`

- When `true`, only the managed allowlist applies; allowlists from user, project, and local settings are ignored. Users cannot broaden it via `~/.claude/settings.json`.
- Denylist still merges from all sources — users can always block servers for themselves.
- Separate from `allowManagedPermissionRulesOnly` (controls permission rules, not MCP).
- Set in a managed settings source alongside `allowedMcpServers`:

```json
{
  "allowManagedMcpServersOnly": true,
  "allowedMcpServers": [{ "serverUrl": "https://api.githubcopilot.com/*" }, { "serverUrl": "https://*.internal.example.com/*" }]
}
```

## `allowAllClaudeAiMcps`

- Set in managed settings to load claude.ai connectors alongside `managed-mcp.json` servers.
- Affects only the connectors Claude Code fetches itself. Cloud sessions receive connectors as server-delivered `--mcp-config` entries — those stay suppressed whenever `managed-mcp.json` is deployed, regardless of this setting.
- No `managed-mcp.json`, on any host, reaches the connectors the desktop app delivers to its own local and SSH sessions — those arrive in-process and are governed by claude.ai organization settings instead.
- Allowlists and denylists still apply to those connectors. Plugin-provided servers stay suppressed.
- Has no effect when placed in user or project settings. Read only from admin-controlled tiers: server-managed settings, an MDM-deployed plist or HKLM registry key, or a system `managed-settings.json`. version >= 2.1.149
- To turn off all claude.ai connectors outright rather than filter them, see `disableClaudeAiConnectors` in `claude-code-mcp-reference.md`.

## How restrictions appear to users

| Restriction                                                | What the user sees                                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `managed-mcp.json` present and user runs `claude mcp add`  | `Cannot add MCP server: enterprise MCP configuration is active and has exclusive control over MCP servers` |
| Server on a denylist and user runs `claude mcp add`        | `Cannot add MCP server "<name>": server is explicitly blocked by enterprise policy`                        |
| Server not on the allowlist and user runs `claude mcp add` | `Cannot add MCP server "<name>": not allowed by enterprise policy`                                         |
| A previously configured server is now blocked by policy    | Server silently disappears from `/mcp` and `claude mcp list` with no warning                               |

- In the last case, the user gets no signal that policy is the reason — inform affected users when rolling out a new restriction.

## Monitor usage

- With OpenTelemetry export configured, set `OTEL_LOG_TOOL_DETAILS=1` to include MCP server and tool names in tool events, then aggregate them in your collector to see which servers users actually connect to. See `/en/monitoring-usage`.

## Configuration summary

| Surface                      | What it controls                                                                                   | Delivery                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `managed-mcp.json`           | Fixed server set, exclusive control                                                                | MDM/GPO/fleet (admin-priv write to system path); cannot be server-managed settings     |
| `allowedMcpServers`          | Allowlist of permitted servers; entries merge from all sources unless `allowManagedMcpServersOnly` | For enforcement: server-managed settings, `managed-settings.json`, MDM plist, registry |
| `deniedMcpServers`           | Denylist of blocked servers; entries always merge from all sources                                 | Same as `allowedMcpServers`                                                            |
| `allowManagedMcpServersOnly` | Locks allowlist to managed sources only; user/project allowlists ignored                           | Managed settings sources only; no effect in user or project settings                   |
| `allowAllClaudeAiMcps`       | Loads claude.ai connectors alongside `managed-mcp.json`; cloud-session connectors stay suppressed  | Managed settings sources only; no effect in user or project settings                   |

## Version notes

| version >= | Feature                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1.149    | `allowAllClaudeAiMcps` setting                                                                                                               |
| 2.1.182    | `serverName` in `deniedMcpServers` accepts any non-empty string                                                                              |
| 2.1.219    | Policy-entry (`allowedMcpServers`/`deniedMcpServers`) `${VAR}` expansion sourced from a pinned environment, not the live process environment |
| 2.1.229    | Cloud sessions with `managed-mcp.json` start with managed servers only (instead of exiting); suppressed servers logged on stderr at `debug`  |
