# Claude Code MCP — Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (MCP overview, MCP quickstart, Managed MCP), verified 2026-07-10.
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

- A JSON entry with `url` but no `type` is invalid (read as stdio, then skipped): `MCP server "<name>" has a "url" but no "type"; add "type": "http" (or "sse" / "ws")`. version >= 2.1.202 (earlier: generic `command: expected string, received undefined`).

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

- Claude Code sets `CLAUDE_PROJECT_DIR` in spawned server environment to project root. Server may also call MCP `roots/list` — returns launch dir + every additional working dir granted via `--add-dir`/`/add-dir`/`additionalDirectories`; sends `notifications/roots/list_changed` on change. version >= 2.1.203 (earlier: launch dir only, no change notification).
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

### Root-level schema combinators

- Tool input schema with a top-level `anyOf`/`oneOf`/`allOf` (API rejects combinators at schema root, only nested inside `properties`) → Claude Code flattens it to one object and prepends a sentence to the tool description naming which params group together. `allOf`: each branch's `required` still enforced. `anyOf`/`oneOf`: `required` is described in text, not schema-enforced — server must still validate. version >= 2.1.195 (earlier, and on deployments without the rewrite e.g. offline: tool is skipped entirely, reason logged; other tools on the server stay available).

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
- `oauth.scopes` takes precedence over `authServerMetadataUrl` and `/.well-known`-discovered scopes. Unset, version >= 2.1.196: requests only the scope named in the server's `WWW-Authenticate` header or protected-resource metadata, no `scope` param sent if neither provides one — no longer requests the full autodiscovered `scopes_supported` catalog (that caused `invalid_scope` on IdPs advertising admin-only/template scopes). A configured `authServerMetadataUrl`'s `scopes_supported` is still requested in full.
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

- Reserved (skipped at load with a warning; `claude mcp add` rejects the name outright): `workspace`, `claude-in-chrome`, `computer-use`, `Claude Preview`, `Claude Browser`. `Claude Preview`/`Claude Browser` both name the desktop app's preview-pane server. version >= 2.1.205: `Claude Browser` became reserved (earlier, a user-configured server could take that name).

## Tool naming & permissions

### Naming conventions

| Server type | Tool name format |
|---|---|
| User-configured server `github` | `mcp__github__<tool>` |
| Plugin-bundled server (plugin `my-plugin`, server key `db`) | `mcp__plugin_my-plugin_db__<tool>` |
| MCP prompt as slash command | `/mcp__<servername>__<promptname>` |

- Characters outside `A-Z a-z 0-9 _ -` in plugin or server names are replaced with `_`.
- A plugin server's own registered name (distinct from its tool-name form above) is `plugin:<plugin-name>:<server-name>` — use this scoped form wherever a configured server name is expected, e.g. an `mcp_tool` hook's `server` field. A hook matcher against the bare server key (`mcp__database-tools__.*`) never fires for a plugin-bundled server — match the full `mcp__plugin_...` form instead.

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

### Force approval per tool

- Server sets `_meta["anthropic/requiresUserInteraction"]: true` on a tool's `tools/list` entry → permission prompt shown on every call, even in `acceptEdits`/`auto`/`bypassPermissions` modes; no "don't ask again"; matching allow-rules don't skip it; `dontAsk` mode denies instead of prompting. Non-interactive `--permission-prompt-tool` allow results are converted to deny; Agent SDK `canUseTool` still receives the call. version >= 2.1.199

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
| `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` | Idle window (ms) before aborting a tool call with no response/progress; default 5 min (HTTP/SSE/WS/connector), 30 min (stdio — version >= 2.1.203, earlier exempt); `0` disables. Not applied to IDE servers or SDK in-process servers. version >= 2.1.187 |

- Per-server `timeout` is a hard wall-clock limit per call; progress notifications do not extend it. Values < 1000 are ignored → fall through to `MCP_TOOL_TIMEOUT`. version >= 2.1.162: sub-1000 ignored (previously floored to 1s). HTTP/SSE first-byte budget has a 60s minimum.
- A per-server `timeout` >= 1000 also floors the idle timeout — idle-abort never fires sooner than that value. version >= 2.1.203

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
- Managed/enterprise MCP restrictions (`managed-mcp.json`, `allowedMcpServers`/`deniedMcpServers`, `allowManagedMcpServersOnly`, `allowAllClaudeAiMcps`): see `claude-code-mcp-managed-reference.md`.

## Version notes

| version >= | Feature |
|---|---|
| 2.1.64 | `oauth.authServerMetadataUrl` field |
| 2.1.121 | `alwaysLoad` field; HTTP/SSE initial connection retried up to 3× on transient errors (5xx, refused, timeout) before marking failed |
| 2.1.161 | Unused claude.ai connectors collapse behind `Show unused connectors` row |
| 2.1.162 | Per-server `timeout` < 1000 now ignored (was floored to 1s); Anthropic-hosted connectors (M365/Gmail/Calendar) direct local-OAuth to claude.ai Settings → Connectors |
| 2.1.186 | `claude mcp login <name>` / `claude mcp logout <name>` CLI OAuth commands |
| 2.1.187 | Remote MCP tool calls idle >5min abort via `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` |
| 2.1.191 | Post-connection capability discovery (`tools/list`/`prompts/list`/`resources/list`) retries transient errors up to 3×; `claude mcp login` auto-detects no local browser and supports `--no-browser`; HTTP 404 shows `MCP endpoint not found at <url>` in `/mcp` (was a generic `Error POSTing to endpoint`) |
| 2.1.193 | `headersHelper` auto-retries once on 401/403 with fresh headers; startup notice when a configured server needs authentication |
| 2.1.195 | `headersHelper` cwd = plugin root for plugin-provided servers; rejected token refresh shows a `/mcp` Re-authenticate notice; root-level `anyOf`/`oneOf`/`allOf` tool schemas are flattened instead of skipped |
| 2.1.196 | Non-interactive (`claude -p`/Agent SDK) runs report an unauthorized server's tools as unavailable-until-authorized; `claude mcp list`/`get` restrict `.mcp.json` approval reads to untrusted-folder-safe settings sources; unset `oauth.scopes` now requests only the `WWW-Authenticate`/protected-resource scope, not the full autodiscovered catalog |
| 2.1.199 | `_meta["anthropic/requiresUserInteraction"]` tool annotation forces a permission prompt on every call |
| 2.1.202 | `url`-without-`type` config entries report a specific error naming the field (was a generic `command: expected string, received undefined`) |
| 2.1.203 | Stdio servers get the 30-min idle timeout (previously exempt); a per-server `timeout` >= 1000 floors the idle timeout; `roots/list` includes granted additional working dirs + sends `notifications/roots/list_changed` |
| 2.1.205 | `Claude Browser` name reserved; ToolSearch surfaces a failed server's connection error to Claude (previously silent); Claude Desktop import skips only invalid names and reports each, instead of aborting the whole import |
