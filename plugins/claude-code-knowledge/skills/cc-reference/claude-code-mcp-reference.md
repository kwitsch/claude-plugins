# Claude Code MCP — Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (MCP overview, MCP quickstart, Managed MCP), verified 2026-06-14.
> Apply when configuring, authoring, or troubleshooting MCP servers in Claude Code.

## What MCP is / when to use

- MCP (Model Context Protocol) = open standard for connecting Claude Code to external tools, databases, and APIs via servers.
- Use when: you repeatedly copy data from an external tool into chat; Claude needs to read or act on a system directly (issue trackers, monitoring dashboards, databases, browsers).
- MCP servers expose **tools** (callable functions), **resources** (readable data), and **prompts** (slash-command templates).
- Server types: remote (HTTP, SSE, WebSocket) and local (stdio process).
- Find servers at mcp.so, Smithery, or build your own.

## Config locations & scopes

| Scope | File | Shared? | Default? |
|---|---|---|---|
| `local` | `~/.claude.json` (under project entry) | No — only you, only this project | Yes |
| `project` | `.mcp.json` in project root | Yes — checked into version control | No |
| `user` | `~/.claude.json` (top-level `mcpServers` key) | No — only you, all projects | No |
| Plugin-provided | bundled in plugin's `.mcp.json` | Yes — all plugin users | N/A |
| Managed (enterprise) | system `managed-mcp.json` | Yes — all users on the machine | N/A |

### Precedence (highest to lowest)

1. Local scope
2. Project scope
3. User scope
4. Plugin-provided servers
5. claude.ai connectors

When the same server name appears in more than one scope, Claude Code uses the highest-precedence definition in full; fields are not merged across scopes.

### Notes

- "Local scope" stores in `~/.claude.json` (home directory) — distinct from `.claude/settings.local.json` (project directory).
- Project-scoped `.mcp.json` requires per-user approval before Claude Code loads it; reset with `claude mcp reset-project-choices`.

## Transports

### HTTP (recommended for remote)

```json
{
  "mcpServers": {
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp",
      "headers": { "Authorization": "Bearer TOKEN" }
    }
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | `"http"` or `"streamable-http"` | Aliases — `streamable-http` accepted for spec compatibility |
| `url` | string | Must use `https://` for OAuth |
| `headers` | object | Static key/value pairs; string values only |
| `headersHelper` | object | Dynamic header generator; see Server config schema |
| `timeout` | number (ms) | Per-request timeout |
| `alwaysLoad` | boolean | Load even when not in active project |
| `oauth` | object | OAuth config; see Authentication |

### SSE (deprecated)

```json
{ "type": "sse", "url": "https://mcp.example.com/sse", "headers": {} }
```

- Same fields as HTTP. Prefer HTTP where available.
- `claude mcp add --transport sse` still accepted.

### stdio (local processes)

```json
{
  "mcpServers": {
    "airtable": {
      "command": "npx",
      "args": ["-y", "airtable-mcp-server"],
      "env": { "AIRTABLE_API_KEY": "YOUR_KEY" }
    }
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `command` | string | Executable path; supports `${VAR}` expansion |
| `args` | array of strings | Passed to command; supports `${VAR}` expansion |
| `env` | object | Key/value injected into server environment |
| `type` | `"stdio"` | Optional; inferred when `command` present |

- Claude Code sets `CLAUDE_PROJECT_DIR` in spawned server environment to project root.
- In `project`/`user` scoped configs, use `${CLAUDE_PROJECT_DIR:-.}` (with default) because the var is set in the server env, not Claude's env.
- Plugin-provided configs may use `${CLAUDE_PROJECT_DIR}` directly (no default needed).

### WebSocket

```json
{ "type": "ws", "url": "wss://mcp.example.com/socket", "headers": { "Authorization": "Bearer TOKEN" } }
```

- Same `url`, `headers`, `headersHelper`, `timeout`, `alwaysLoad` fields as HTTP.
- Authentication is header-only; no OAuth support.
- `claude mcp add --transport` does not accept `ws` — use `claude mcp add-json` instead.
- Use for servers that push events unprompted; otherwise prefer HTTP.

## Server config schema

### Stdio server fields

| Field | Type | Required | Description |
|---|---|---|---|
| `command` | string | Yes | Executable |
| `args` | string[] | No | Arguments |
| `env` | object | No | Environment vars injected into server process |

### HTTP / SSE / WS server fields

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | Yes | `http`, `streamable-http`, `sse`, or `ws` |
| `url` | string | Yes | Server URL |
| `headers` | object | No | Static headers (string values) |
| `headersHelper` | object | No | Dynamic header generator |
| `timeout` | number | No | Request timeout in ms |
| `alwaysLoad` | boolean | No | Load outside active project context |
| `oauth` | object | No | OAuth config; `clientId`, `clientSecret`, `scopes`, `authServerMetadataUrl` |

### Dynamic headers (`headersHelper`)

```json
{
  "headersHelper": {
    "command": "node",
    "args": ["/path/to/generate-token.js"]
  }
}
```

- Helper must write a JSON object of string key/value pairs to stdout.
- Runs in a shell with a 10-second timeout; no output caching — runs fresh on each connection.
- Dynamic headers override static `headers` with the same name.
- Claude Code sets `CLAUDE_CODE_MCP_SERVER_NAME` and `CLAUDE_CODE_MCP_SERVER_URL` in the helper's environment for multi-server scripts.

### Environment variable expansion in `.mcp.json`

| Syntax | Behavior |
|---|---|
| `${VAR}` | Expands to value of `VAR`; fails parse if unset |
| `${VAR:-default}` | Expands to `VAR` if set, otherwise `default` |

Expansion applies in: `command`, `args`, `env`, `url`, `headers`.

```json
{
  "mcpServers": {
    "api-server": {
      "type": "http",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": { "Authorization": "Bearer ${API_KEY}" }
    }
  }
}
```

## Authentication

### OAuth 2.0 flow (HTTP servers)

- Triggered automatically when server responds `401 Unauthorized` or `403 Forbidden`.
- If `headers.Authorization` is set and rejected, Claude Code reports connection failed — it does not fall back to OAuth. Remove the header to use OAuth.

Steps:
1. `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp`
2. Run `/mcp` inside Claude Code and follow browser login.
3. Tokens stored securely, refreshed automatically.
4. Use "Clear authentication" in `/mcp` menu to revoke.

### OAuth options

| Option | CLI flag | Config field | Description |
|---|---|---|---|
| Fixed callback port | `--callback-port PORT` | — | Fixes OAuth redirect URI to `http://localhost:PORT/callback` |
| Pre-configured client ID | `--client-id ID` | `oauth.clientId` | Skip dynamic client registration |
| Pre-configured client secret | `--client-secret SECRET` | `oauth.clientSecret` | Use with `clientId` |
| Custom auth server | — | `oauth.authServerMetadataUrl` | Override autodiscovery metadata URL |
| Restricted scopes | — | `oauth.scopes` | Space-separated scope string (RFC 6749 §3.3) |

```json
{
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": { "scopes": "channels:read chat:write search:read" }
    }
  }
}
```

### Static header authentication

```bash
claude mcp add --transport http secure-api https://api.example.com/mcp \
  --header "Authorization: Bearer TOKEN"
```

- Pass multiple `--header` flags for multiple headers.
- Values stored in config; use `${VAR}` expansion to avoid hardcoded secrets.

## Adding & managing servers

### `claude mcp add` (HTTP/SSE)

```bash
claude mcp add --transport http <name> <url>
claude mcp add --transport http <name> --scope project <url>
claude mcp add --transport http <name> --scope user <url>
claude mcp add --transport sse <name> <url>
claude mcp add --transport http <name> --header "Key: value" <url>
claude mcp add --transport http <name> --callback-port 8080 <url>
```

### `claude mcp add` (stdio)

```bash
# -- separates Claude's flags from the server command+args
claude mcp add --transport stdio <name> -- <command> [server-args...]
claude mcp add --env KEY=value --transport stdio <name> -- <command>
```

### `claude mcp add-json`

```bash
claude mcp add-json <name> '{"type":"ws","url":"wss://example.com/socket"}'
```

- Accepts full JSON server entry; use for WebSocket or complex configs.

### Management commands

```bash
claude mcp list          # List all configured servers (shows ⏸ Pending / ✗ Rejected)
claude mcp get <name>    # Show details for one server
claude mcp remove <name> # Remove a server
claude mcp reset-project-choices  # Clear project-scope approval decisions
```

### `/mcp` slash command

- Shows connected servers, tool counts, connection status.
- Flags servers advertising tools capability but exposing none.
- Triggers OAuth flow for servers in `⏸` state.
- "Clear authentication" revokes OAuth tokens per server.

### Reserved names

- `workspace` is reserved; a server with that name is skipped at load with a warning.

## Tool naming & permissions

### Naming conventions

| Server type | Tool name format |
|---|---|
| User-configured server `github` | `mcp__github__<tool>` |
| Plugin-bundled server (plugin `my-plugin`, server key `db`) | `mcp__plugin_my-plugin_db__<tool>` |
| MCP prompt as slash command | `/mcp__<servername>__<promptname>` |

- Characters outside `A-Z a-z 0-9 _ -` in plugin or server names are replaced with `_`.

### Approval

- Project-scoped servers from `.mcp.json` require one-time user approval before loading.
- Approved/rejected state stored per project; reset with `claude mcp reset-project-choices`.

### Permission rules

- Reference MCP tools by full name in `allowedTools` / `deniedTools` permission rules.
- Use full name in a skill's `allowed-tools` frontmatter field.
- Use full name in a subagent's `tools` field.

```text
# Allow one MCP tool in permissions
mcp__github__create_pr

# Allow all tools from one server
mcp__github__*
```

### Dynamic tool discovery

- Tools are discovered at session start; updates (tools added/removed mid-session) trigger automatic discovery without session restart.

## Managed MCP / enterprise

### `managed-mcp.json` — exclusive control

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

- Place at the system-managed settings path (MDM plist / HKLM registry / system `managed-mcp.json`).
- `claude mcp add` fails with `Cannot add MCP server: enterprise MCP configuration is active...`.
- `claude mcp list` shows only servers from this file.
- Deploy empty `{ "mcpServers": {} }` to disable MCP entirely.
- Do not store credentials in `env` blocks — readable by any user; use `${VAR}` expansion, OAuth, or `headersHelper` instead.

### Allowlists and denylists

Set in managed settings (e.g., `managed-settings.json`):

```json
{
  "allowedMcpServers": [
    { "serverUrl": "https://mcp.example.com/*" },
    { "serverName": "github" },
    { "serverCommand": ["npx", "-y", "approved-package"] }
  ],
  "deniedMcpServers": [
    { "serverUrl": "https://staging.example.com/*" }
  ],
  "allowManagedMcpServersOnly": true
}
```

| Field | Type | Matches |
|---|---|---|
| `serverUrl` | string (glob) | HTTP/SSE/WS server URL; `*` wildcard anywhere |
| `serverName` | string | Server name in config |
| `serverCommand` | string[] | Stdio command + args; exact match, every argument |

### Evaluation order

1. Merge lists from all settings sources (when `allowManagedMcpServersOnly: true`, only managed allowlist is kept; denylist always merges from all sources).
2. Denylist check: any match → blocked; nothing overrides.
3. Allowlist check: if `allowedMcpServers` not set → all remaining load; if set, server must match an entry of the appropriate type (URL entry for HTTP; command entry for stdio; name entry counts only when no typed entries exist).

### URL wildcard matching rules

| Pattern | Allows |
|---|---|
| `https://mcp.example.com/*` | All paths on that domain |
| `https://*.example.com/*` | Any subdomain of example.com |
| `http://localhost:*/*` | Any port on localhost |
| `*://mcp.example.com/*` | Any scheme to that domain |

- Hostname matching: case-insensitive, trailing FQDN dot ignored.
- Path matching: case-sensitive.
- Command matching: exact array comparison including every argument and order.

### `allowManagedMcpServersOnly`

- When `true`, only the managed allowlist applies; users cannot broaden it via `~/.claude/settings.json`.
- Separate from `allowManagedPermissionRulesOnly` (controls permission rules, not MCP).

### `allowAllClaudeAiMcps`

- Set in managed settings to load claude.ai connectors alongside `managed-mcp.json` servers.
- Allowlists and denylists still apply to those connectors.
- Has no effect when placed in user or project settings; must come from admin-controlled tiers.

## Version notes

| version >= | Feature |
|---|---|
| 2.1.64 | `oauth.authServerMetadataUrl` field |
| 2.1.121 | HTTP/SSE initial connection retried up to 3× on transient errors (5xx, refused, timeout) before marking failed |
| 2.1.149 | `allowAllClaudeAiMcps` setting |
