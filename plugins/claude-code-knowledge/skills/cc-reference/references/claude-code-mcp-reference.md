# Claude Code MCP — Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (MCP overview, MCP quickstart, Managed MCP), verified 2026-07-03.
> Apply when configuring, authoring, or troubleshooting MCP servers in Claude Code.

## What MCP is / when to use

- MCP (Model Context Protocol) = open standard for connecting Claude Code to external tools, databases, and APIs via servers.
- Use when: you repeatedly copy data from an external tool into chat; Claude needs to read or act on a system directly (issue trackers, monitoring dashboards, databases, browsers).
- MCP servers expose **tools** (callable functions), **resources** (readable data), and **prompts** (slash-command templates).
- Server types: remote (HTTP, SSE, WebSocket) and local (stdio process).
- Find servers in the Anthropic MCP directory (claude.ai/directory), or build your own.

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

When the same server appears in more than one source, Claude Code uses the highest-precedence definition in full; fields are not merged. The three scopes match duplicates by name; plugins and connectors match by endpoint (same URL or command).

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
| `headersHelper` | string | Shell command (script path or inline) that prints JSON headers; see Server config schema |
| `timeout` | number (ms) | Per-request timeout |
| `alwaysLoad` | boolean | Exempt server's tools from tool-search deferral — load all upfront; see Tool search. version >= 2.1.121 |
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

- Claude Code sets `CLAUDE_PROJECT_DIR` in spawned server environment to project root. Server may also call MCP `roots/list` to get the launch directory.
- In `project`/`user` scoped configs, use `${CLAUDE_PROJECT_DIR:-.}` (with default) because the var is set in the server env, not Claude's env.
- Plugin-provided configs may use `${CLAUDE_PROJECT_DIR}` directly (no default needed). Plugin configs also expand `${CLAUDE_PLUGIN_ROOT}` (bundled files) and `${CLAUDE_PLUGIN_DATA}` (persistent state surviving plugin updates).

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
| `headersHelper` | string | No | Shell command (script path or inline) printing JSON headers |
| `timeout` | number | No | Per-tool-call wall-clock timeout in ms; values < 1000 ignored → fall through to `MCP_TOOL_TIMEOUT` (default ~28h). HTTP/SSE first-byte budget has a 60s minimum |
| `alwaysLoad` | boolean | No | Exempt from tool-search deferral; blocks startup until connected (capped at 5s connect timeout). version >= 2.1.121 |
| `oauth` | object | No | OAuth config; `clientId`, `scopes`, `authServerMetadataUrl`, `callbackPort` (the client secret is a CLI flag / keychain, never a config field) |

### Dynamic headers (`headersHelper`)

- `headersHelper` is a **string** — a script path or inline shell command. Use for non-OAuth auth (Kerberos, short-lived tokens, internal SSO).

```json
{ "headersHelper": "/opt/bin/get-mcp-auth-headers.sh" }
```

```json
{ "headersHelper": "echo '{\"Authorization\": \"Bearer '\"$(get-token)\"'\"}'" }
```

- Helper must write a JSON object of string key/value pairs to stdout.
- Runs in a shell with a 10-second timeout; no output caching — runs fresh on each connection (session start and reconnect). Script owns any token reuse.
- Dynamic headers override static `headers` with the same name.
- Claude Code sets `CLAUDE_CODE_MCP_SERVER_NAME` and `CLAUDE_CODE_MCP_SERVER_URL` in the helper's environment for multi-server scripts; plugin-provided servers also get `CLAUDE_PLUGIN_ROOT`.
- Executes arbitrary shell. At project/local scope it runs only after you accept the workspace trust dialog.
- A tool call returning 401/403 auto-reruns the helper, reconnects with fresh headers, and retries once; the server is flagged needing authentication in `/mcp` only if that retry also fails. version >= 2.1.193
- For a plugin-provided server, the helper's working directory is the plugin root, so a relative `headersHelper` path resolves inside the plugin dir (not the session cwd). version >= 2.1.195

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

- Triggered automatically when server responds `401 Unauthorized` or `403 Forbidden`, or returns a `WWW-Authenticate` header pointing to its auth server.
- If `headers.Authorization` is set and rejected, Claude Code reports connection failed — it does not fall back to OAuth. Remove the header to use OAuth.
- OAuth applies to HTTP/SSE only; flags have no effect on stdio servers.

Steps:
1. `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp`
2. Run `/mcp` inside Claude Code and follow browser login.
3. Tokens stored securely, refreshed automatically.
4. Use "Clear authentication" in `/mcp` menu to revoke.

- If the browser redirect fails after authenticating, paste the full callback URL into the URL prompt Claude Code shows.
- `claude mcp login <name>` (see Management commands) also runs this flow from the shell. Rejected token refresh and server-needs-auth notices: see Version notes.
- Non-interactive (`claude -p` / Agent SDK) with tool search on: an unauthorized server's tools are reported to Claude as unavailable-until-authorized rather than silently missing; authorize via `/mcp` or `claude mcp login <name>` from an interactive session first. version >= 2.1.196

### Discovery chain

- Default order: RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource`, then RFC 8414 auth-server metadata at `/.well-known/oauth-authorization-server`.
- Supports Dynamic Client Registration (DCR) and Client ID Metadata Document (CIMD), discovered automatically.
- "Incompatible auth server: does not support dynamic client registration" → server needs pre-configured credentials (`--client-id` / `oauth.clientId`).

### OAuth options

| Option | CLI flag | Config field | Description |
|---|---|---|---|
| Fixed callback port | `--callback-port PORT` | `oauth.callbackPort` | Fixes OAuth redirect URI to `http://localhost:PORT/callback`; usable with or without `--client-id` |
| Pre-configured client ID | `--client-id ID` | `oauth.clientId` | Skip dynamic client registration |
| Pre-configured client secret | `--client-secret` | — | Bare flag prompts for secret with masked input; `MCP_CLIENT_SECRET` env var skips the prompt (CI). Stored in system keychain (macOS) or a credentials file, not in config. Public clients: use `--client-id` alone |
| Custom auth server | — | `oauth.authServerMetadataUrl` | Override autodiscovery metadata URL (must be `https://`); its `scopes_supported` overrides upstream. version >= 2.1.64 |
| Restricted scopes | — | `oauth.scopes` | Space-separated scope string (RFC 6749 §3.3) |

Scope rules:
- `oauth.scopes` takes precedence over `authServerMetadataUrl` and `/.well-known`-discovered scopes. Unset → server determines scopes.
- If the auth server advertises `offline_access`, it is appended so tokens refresh without re-sign-in.
- A 403 `insufficient_scope` re-authenticates with the same pinned scopes; widen `oauth.scopes` if a tool needs more.

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
claude mcp login <name>  # Run a configured server's OAuth flow from the shell. version >= 2.1.186
claude mcp logout <name> # Clear stored OAuth credentials for a server
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
- `claude mcp list`/`claude mcp get` read `.mcp.json` approvals only from settings NOT checked into the repo until the workspace-trust dialog is accepted. A freshly cloned repo can't self-approve: a committed `enableAllProjectMcpServers` or `enabledMcpjsonServers` in project `.claude/settings.json` is ignored in an untrusted folder — the server stays `⏸ Pending approval`. version >= 2.1.196
- Approvals still apply in an untrusted folder from: user `~/.claude/settings.json`, managed settings, `--settings`-passed files, and `.claude/settings.local.json` (only if git doesn't track it).
- A `disabledMcpjsonServers` entry in any settings file always rejects the server, trusted or not.

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

- Tools discovered at session start; MCP `list_changed` notifications refresh tools/prompts/resources mid-session without reconnect.

### Reconnection & startup retry

- Mid-session: HTTP/SSE servers that drop reconnect with exponential backoff — up to 5 attempts, 1s initial delay, doubling. Marked failed after; retry from `/mcp`. Stdio not auto-reconnected.
- Startup: HTTP/SSE initial connection retried up to 3× on transient errors (5xx, refused, timeout). Auth/not-found errors are NOT retried. version >= 2.1.121
- Post-connection capability discovery also retries transient errors; a stalled remote tool call aborts on an idle timer — see `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` in Timeouts (env) and Version notes.

## Tool search

- Default: MCP tool definitions are deferred — only tool names + server instructions load at session start. Claude uses a search tool to pull relevant tools on demand. No fixed per-server tool cap; budget is the context window.
- Disabled by default on Vertex AI and when `ANTHROPIC_BASE_URL` is a non-first-party host (most proxies drop `tool_reference` blocks). Requires a model supporting `tool_reference`; Haiku does not. On Vertex: Sonnet 4.5+ / Opus 4.5+.
- Tool descriptions and server instructions truncate at 2KB each — keep terse, critical detail first.
- With tool search on, a needed server still connecting blocks inside the `ToolSearch` call; without it (Vertex / custom base URL / `ENABLE_TOOL_SEARCH=false`), the `WaitForMcpServers` tool is used.
- `alwaysLoad: true` on a server (or `_meta["anthropic/alwaysLoad"]: true` on a tool) exempts it from deferral — loaded upfront every turn; also blocks startup until connected (capped at 5s).

### `ENABLE_TOOL_SEARCH`

| Value | Behavior |
|---|---|
| (unset) | All deferred, on demand; falls back to upfront on Vertex/non-first-party base URL |
| `true` | All deferred; sends beta header even on Vertex/proxies (fails on unsupported models) |
| `auto` | Threshold: load upfront if tools fit within 10% of context window, defer overflow |
| `auto:N` | Threshold with custom percent `N` (0-100), e.g. `auto:5` |
| `false` | All loaded upfront, no deferral |

- Disable the search tool itself via `permissions.deny: ["ToolSearch"]`.

## Output limits

- Warning when any MCP tool output exceeds 10,000 tokens.
- `MAX_MCP_OUTPUT_TOKENS` env var raises the cap; default 25,000. Applies to tools without their own declared limit; image-returning tools always subject to it.
- Server authors: set `_meta["anthropic/maxResultSizeChars"]` in a tool's `tools/list` entry to raise that tool's persist-to-disk threshold for text content, up to a 500,000-char ceiling (independent of `MAX_MCP_OUTPUT_TOKENS`). Over-threshold results without the annotation are persisted to disk and replaced with a file reference.

## Timeouts (env)

| Var | Controls |
|---|---|
| `MCP_TIMEOUT` | Server startup timeout in ms (default 30s) |
| `MCP_TOOL_TIMEOUT` | Default per-tool-call timeout; per-server `timeout` field overrides it. Default ~28h when unset |
| `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` | Idle window (ms) before aborting a remote (HTTP/SSE/WS/connector) tool call with no response/progress; default 5 min, `0` disables. Not applied to stdio. version >= 2.1.187 |

- Per-server `timeout` is a hard wall-clock limit per call; progress notifications do not extend it. Values < 1000 are ignored → fall through to `MCP_TOOL_TIMEOUT`. version >= 2.1.162: sub-1000 ignored (previously floored to 1s). HTTP/SSE first-byte budget has a 60s minimum.

## claude.ai connectors

- Connectors added at claude.ai/customize/connectors load automatically in the CLI when signed in with that Claude.ai account; appear in `/mcp` flagged as claude.ai.
- Fetched only when the active auth method is the Claude.ai subscription — NOT when `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`, or Bedrock/Vertex is active. Run `/status` to check; `/login` to select the Claude.ai account.
- A CLI-added server takes precedence over a connector at the same URL (connector listed hidden).
- version >= 2.1.161: connectors never signed in to collapse behind a `Show unused connectors` row.
- version >= 2.1.162: Anthropic-hosted connectors needing claude.ai-registered redirect (Microsoft 365, Gmail, Google Calendar) cannot do local OAuth from `/mcp`; connect them at Settings → Connectors on claude.ai.
- Disable all: `disableClaudeAiConnectors: true` (any settings scope; any-source-true — a project `false` cannot re-enable a user/policy `true`) or `ENABLE_CLAUDEAI_MCP_SERVERS=false`. Block individual ones via `deniedMcpServers` by `serverName`/`serverUrl`. Servers passed via `--mcp-config` are unaffected. On Claude Code on the web these settings do not apply (connectors arrive as `--mcp-config`, URLs rewritten through the session proxy).

## Cross-references (one level deep)

- Channels: a server with the `claude/channel` capability, opted in via `--channels` at startup, pushes messages into the session. See `/en/channels`, `/en/channels-reference`.
- Elicitation: servers request structured input mid-task (form or URL mode) — dialogs appear automatically; auto-respond via the `Elicitation` hook (`/en/hooks#elicitation`).
- Resources: reference via `@server:protocol://resource/path` mentions.
- `claude mcp serve` — run Claude Code itself as a stdio MCP server.
- `claude mcp add-from-claude-desktop` — import Claude Desktop servers (macOS/WSL).
- `CLAUDE_CONFIG_DIR` env var relocates `.claude.json`.
- OTEL: `OTEL_LOG_TOOL_DETAILS=1` includes MCP server/tool names in tool events (see `/en/monitoring-usage`).

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

- When present, ONLY these servers load — including plugin-provided servers and (by default) claude.ai connectors are suppressed.
- Standalone file; cannot be delivered via server-managed settings. Deploy via MDM/GPO/Intune/fleet tooling (any admin-priv write).

| Platform | Path |
|---|---|
| macOS | `/Library/Application Support/ClaudeCode/managed-mcp.json` |
| Linux/WSL | `/etc/claude-code/managed-mcp.json` |
| Windows | `C:\Program Files\ClaudeCode\managed-mcp.json` |

- `claude mcp add` fails with `Cannot add MCP server: enterprise MCP configuration is active and has exclusive control over MCP servers`.
- `claude mcp add` on a denylisted server fails with `Cannot add MCP server "<name>": server is explicitly blocked by enterprise policy`; on a server outside the allowlist: `Cannot add MCP server "<name>": not allowed by enterprise policy`.
- `claude mcp list` shows only servers from this file.
- Deploy empty `{ "mcpServers": {} }` to disable MCP entirely; a server a new policy blocks (including this case) silently disappears from `/mcp`/`claude mcp list` — no warning shown.
- Do not store credentials in `env` blocks — readable by any user; use `${VAR}` expansion, OAuth, or `headersHelper` instead.
- Plugin-servers-only pattern (no managed-mcp.json): `strictPluginOnlyCustomization` with `mcp` in its list — servers may come only from plugins; users cannot add their own.

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
| `serverUrl` | string (glob) | HTTP/SSE server URL; `*` wildcard anywhere |
| `serverName` | string | User-assigned label; exact match, no wildcards. NOT a security control (user picks any name) |
| `serverCommand` | string[] | Stdio command + args; exact match, every argument |

`allowedMcpServers` unset vs empty:

| Setting | Unset (default) | Empty `[]` | Populated |
|---|---|---|---|
| `allowedMcpServers` | All allowed | None allowed | Only matching allowed |
| `deniedMcpServers` | None blocked | None blocked | Matching blocked |

`serverName` validation differs by list:
- `allowedMcpServers`: limited to letters/numbers/`-`/`_`. Use `serverUrl` to allowlist a claude.ai connector.
- `deniedMcpServers`: accepts any non-empty string — block a claude.ai connector by display name, e.g. `{ "serverName": "claude.ai Slack" }`. version >= 2.1.182. Prefer `serverUrl` to be robust to renames / ` (N)` suffix collisions.

### Evaluation order

1. Merge lists from all settings sources (when `allowManagedMcpServersOnly: true`, only managed allowlist is kept; denylist always merges from all sources).
2. Denylist check: any match → blocked; nothing overrides.
3. Allowlist check: if `allowedMcpServers` not set anywhere → all remaining load. If set: remote (HTTP/SSE) must match a `serverUrl` entry (a `serverName` match counts only when no `serverUrl` entries exist); stdio must match a `serverCommand` entry (a `serverName` match counts only when no `serverCommand` entries exist).

### URL wildcard matching rules

| Pattern | Allows |
|---|---|
| `https://mcp.example.com/*` | All paths on that domain |
| `https://mcp.example.com` | Also all paths on that domain (no path = any path) |
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
- Allowlists and denylists still apply to those connectors. Affects only claude.ai connectors — plugin-provided servers stay suppressed.
- Has no effect when placed in user or project settings; must come from admin-controlled tiers. version >= 2.1.149

## Version notes

| version >= | Feature |
|---|---|
| 2.1.64 | `oauth.authServerMetadataUrl` field |
| 2.1.121 | `alwaysLoad` field; HTTP/SSE initial connection retried up to 3× on transient errors (5xx, refused, timeout) before marking failed |
| 2.1.149 | `allowAllClaudeAiMcps` setting |
| 2.1.161 | Unused claude.ai connectors collapse behind `Show unused connectors` row |
| 2.1.162 | Per-server `timeout` < 1000 now ignored (was floored to 1s); Anthropic-hosted connectors (M365/Gmail/Calendar) direct local-OAuth to claude.ai Settings → Connectors |
| 2.1.182 | `serverName` in `deniedMcpServers` accepts any non-empty string |
| 2.1.186 | `claude mcp login <name>` / `claude mcp logout <name>` CLI OAuth commands |
| 2.1.187 | Remote MCP tool calls idle >5min abort via `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` |
| 2.1.191 | Post-connection capability discovery (`tools/list`/`prompts/list`/`resources/list`) retries transient errors up to 3×; `claude mcp login` auto-detects no local browser and supports `--no-browser` |
| 2.1.193 | `headersHelper` auto-retries once on 401/403 with fresh headers; startup notice when a configured server needs authentication |
| 2.1.195 | `headersHelper` cwd = plugin root for plugin-provided servers; rejected token refresh shows a `/mcp` Re-authenticate notice |
| 2.1.196 | Non-interactive (`claude -p`/Agent SDK) runs report an unauthorized server's tools as unavailable-until-authorized; `claude mcp list`/`get` restrict `.mcp.json` approval reads to untrusted-folder-safe settings sources |
