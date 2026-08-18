# Claude Code MCP — Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (MCP overview, MCP quickstart, Managed MCP), verified 2026-08-18.
> Apply when configuring, authoring, or troubleshooting MCP servers in Claude Code.

## What MCP is / when to use

- MCP (Model Context Protocol) = open standard for connecting Claude Code to external tools, databases, and APIs via servers.
- Use when: you repeatedly copy data from an external tool into chat; Claude needs to read or act on a system directly (issue trackers, monitoring dashboards, databases, browsers).
- MCP servers expose **tools** (callable functions), **resources** (readable data), and **prompts** (slash-command templates).
- Server types: remote (HTTP, SSE, WebSocket) and local (stdio process).
- Find servers in the Anthropic MCP directory (claude.ai/directory), or build your own.
- Scaffold one with the official `mcp-server-dev` plugin: `/plugin install mcp-server-dev@claude-plugins-official`, then `/mcp-server-dev:build-mcp-server` — asks about your use case, scaffolds a remote HTTP or local stdio server.

## Config locations & scopes

| Scope                | File                                          | Shared?                            | Default? |
| -------------------- | --------------------------------------------- | ---------------------------------- | -------- |
| `local`              | `~/.claude.json` (under project entry)        | No — only you, only this project   | Yes      |
| `project`            | `.mcp.json` in project root                   | Yes — checked into version control | No       |
| `user`               | `~/.claude.json` (top-level `mcpServers` key) | No — only you, all projects        | No       |
| Plugin-provided      | bundled in plugin's `.mcp.json`               | Yes — all plugin users             | N/A      |
| Managed (enterprise) | system `managed-mcp.json`                     | Yes — all users on the machine     | N/A      |

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

### Plugin-provided server lifecycle

- Session startup: Claude Code connects an enabled plugin's servers automatically. A remote (HTTP/SSE) plugin server used before may instead show a `cached` status and connect on first tool call — see Discovery cache under Reconnection & startup retry.
- `/reload-plugins` connects/disconnects a plugin's MCP servers after you enable/disable it mid-session. Reload keeps the live connection of any plugin server whose config is unchanged; an Agent SDK session that replaces the server list without naming a plugin server does the same. version >= 2.1.210 (earlier: an unnamed plugin server was disconnected).

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

| Field           | Type                            | Notes                                                                                                   |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `type`          | `"http"` or `"streamable-http"` | Aliases — `streamable-http` accepted for spec compatibility                                             |
| `url`           | string                          | Must use `https://` for OAuth                                                                           |
| `headers`       | object                          | Static key/value pairs; string values only                                                              |
| `headersHelper` | string                          | Shell command (script path or inline) that prints JSON headers; see Server config schema                |
| `timeout`       | number (ms)                     | Per-tool-call wall-clock timeout; see Server config schema and Timeouts (env)                           |
| `alwaysLoad`    | boolean                         | Exempt server's tools from tool-search deferral — load all upfront; see Tool search. version >= 2.1.121 |
| `oauth`         | object                          | OAuth config; see Authentication                                                                        |

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

| Field     | Type             | Notes                                          |
| --------- | ---------------- | ---------------------------------------------- |
| `command` | string           | Executable path; supports `${VAR}` expansion   |
| `args`    | array of strings | Passed to command; supports `${VAR}` expansion |
| `env`     | object           | Key/value injected into server environment     |
| `type`    | `"stdio"`        | Optional; inferred when `command` present      |

- Claude Code sets `CLAUDE_PROJECT_DIR` in spawned server environment to project root. Server may also call MCP `roots/list` — returns launch dir + every additional working dir granted via `--add-dir`/`/add-dir`/`additionalDirectories`; sends `notifications/roots/list_changed` on change. version >= 2.1.203 (earlier: launch dir only, no change notification).
- In a project-scoped `.mcp.json` and in local- or user-scoped entries in `~/.claude.json`, use `${CLAUDE_PROJECT_DIR:-.}` (with default) because the var is set in the server env, not Claude's env.
- Plugin-provided configs may use `${CLAUDE_PROJECT_DIR}` directly (no default needed). Plugin configs also expand `${CLAUDE_PLUGIN_ROOT}` (bundled files) and `${CLAUDE_PLUGIN_DATA}` (persistent state surviving plugin updates). Substitution applies to stdio `command`/`args`/`env` and to http/sse/ws `url`/`headers`/`headersHelper` (`headersHelper` version >= 2.1.195; earlier passed the placeholder through literally).
- Web sessions: an MCP call to a plugin server not yet connected (e.g. right after an idle session wakes) starts it on demand and waits. version >= 2.1.211 (earlier: such calls failed until the next message started a turn).

### WebSocket

```json
{
  "type": "ws",
  "url": "wss://mcp.example.com/socket",
  "headers": { "Authorization": "Bearer TOKEN" }
}
```

- Same `url`, `headers`, `headersHelper`, `timeout`, `alwaysLoad` fields as HTTP.
- No per-request first-byte timer (stdio has none either) — only HTTP/SSE/claude.ai-connector servers have one.
- Authentication is header-only; no OAuth support.
- `claude mcp add --transport` does not accept `ws` — use `claude mcp add-json` instead.
- Use for servers that push events unprompted; otherwise prefer HTTP.
- WebSocket servers do not appear in `claude mcp list` output — check them via `claude mcp get <name>` or the `/mcp` panel.

## Server config schema

### Stdio server fields

| Field     | Type     | Required | Description                                   |
| --------- | -------- | -------- | --------------------------------------------- |
| `command` | string   | Yes      | Executable                                    |
| `args`    | string[] | No       | Arguments                                     |
| `env`     | object   | No       | Environment vars injected into server process |

### HTTP / SSE / WS server fields

| Field           | Type    | Required | Description                                                                                                                                                                      |
| --------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`          | string  | Yes      | `http`, `streamable-http`, `sse`, or `ws`                                                                                                                                        |
| `url`           | string  | Yes      | Server URL                                                                                                                                                                       |
| `headers`       | object  | No       | Static headers (string values)                                                                                                                                                   |
| `headersHelper` | string  | No       | Shell command (script path or inline) printing JSON headers                                                                                                                      |
| `timeout`       | number  | No       | Per-tool-call wall-clock timeout in ms; values < 1000 ignored → fall through to `MCP_TOOL_TIMEOUT` (default ~28h). See Timeouts (env) for the separate HTTP/SSE first-byte timer |
| `alwaysLoad`    | boolean | No       | Exempt from tool-search deferral; blocks startup until connected (capped at 5s connect timeout). version >= 2.1.121                                                              |
| `oauth`         | object  | No       | OAuth config; `clientId`, `scopes`, `authServerMetadataUrl`, `callbackPort` (the client secret is a CLI flag / keychain, never a config field)                                   |

### Dynamic headers (`headersHelper`)

- `headersHelper` is a **string** — a script path or inline shell command. Use for non-OAuth auth (Kerberos, short-lived tokens, internal SSO).

```json
{ "headersHelper": "/opt/bin/get-mcp-auth-headers.sh" }
```

```json
{ "headersHelper": "echo '{\"Authorization\": \"Bearer '\"$(get-token)\"'\"}'" }
```

- Helper must write a JSON object of string key/value pairs to stdout.
- Runs in a shell with a 10-second timeout, from the session's cwd — use an absolute path or a `PATH` command. No output caching: runs fresh on each connection (session start and reconnect). Script owns any token reuse.
- Dynamic headers override static `headers` with the same name.
- Claude Code sets `CLAUDE_CODE_MCP_SERVER_NAME` and `CLAUDE_CODE_MCP_SERVER_URL` in the helper's environment for multi-server scripts; plugin-provided servers also get `CLAUDE_PLUGIN_ROOT`.
- Executes arbitrary shell. When defined at project or local scope, follows the workspace trust rule: in non-interactive sessions (`-p`) it runs even in a folder you've never trusted; in interactive sessions it runs only after you accept the workspace trust dialog.
- A tool call returning 401/403 auto-reruns the helper, reconnects with fresh headers, and retries once; the server is flagged needing authentication in `/mcp` only if that retry also fails. version >= 2.1.193
- For a plugin-provided server, the helper's working directory is the plugin root, so a relative `headersHelper` path resolves inside the plugin dir (not the session cwd). version >= 2.1.195
- A plugin-provided `headersHelper` must NOT reference `${user_config.*}` — the command is shell-parsed, so the value is not substituted and the server is reported misconfigured. Put `${user_config.KEY}` in `headers` (not shell-parsed) instead, or have the helper read it from its own env/config file. version >= 2.1.207 (earlier: substituted).

### Environment variable expansion in `.mcp.json`

| Syntax            | Behavior                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `${VAR}`          | Expands to value of `VAR`. Unset with no default: the config still loads — `claude mcp list` reports a missing-variable warning for that server and the unexpanded `${VAR}` text is used as-is |
| `${VAR:-default}` | Expands to `VAR` if set, otherwise `default`                                                                                                                                                   |

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

### Configuration warnings

- Claude Code checks `command`, `url`, each `args` entry, and the keys/values under `env` and `headers` for hidden leading/trailing whitespace (a common artifact of pasting a token with a trailing newline). Shown in `claude mcp list` output and in `/mcp`, naming only the affected field, e.g. `Leading or trailing whitespace in: headers.Authorization` — never echoes the value. Claude Code does not trim it; edit the config to remove it.

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
- A `401` on a server you already signed in to refreshes the stored token, reconnects, and retries the request once; flagged in `/mcp` only if that retry also fails. version >= 2.1.206 (earlier: a transient refresh failure flagged the server for the rest of the session).
- Startup notice lists configured servers needing authentication. version >= 2.1.193; version >= 2.1.218 counts only servers signable-in from Claude Code (earlier it also counted claude.ai connectors, which can only be connected in claude.ai).
- `claude mcp login <name>` (see Management commands) also runs this flow from the shell. Rejected token refresh notice: see Version notes.
- Non-interactive (`claude -p` / Agent SDK) with tool search on: an unauthorized server's tools are reported to Claude as unavailable-until-authorized rather than silently missing; authorize via `/mcp` or `claude mcp login <name>` from an interactive session first. version >= 2.1.196

### Discovery chain

- Default order: RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource`, then RFC 8414 auth-server metadata at `/.well-known/oauth-authorization-server`.
- Supports Dynamic Client Registration (DCR) and Client ID Metadata Document (CIMD), discovered automatically.
- "Incompatible auth server: does not support dynamic client registration" → server needs pre-configured credentials (`--client-id` / `oauth.clientId`).

### OAuth options

| Option                       | CLI flag               | Config field                  | Description                                                                                                                                                                                                        |
| ---------------------------- | ---------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fixed callback port          | `--callback-port PORT` | `oauth.callbackPort`          | Fixes OAuth redirect URI to `http://localhost:PORT/callback`; usable with or without `--client-id`. version >= 2.1.229 bug: sent `127.0.0.1` instead of `localhost`; fixed in 2.1.231                              |
| Pre-configured client ID     | `--client-id ID`       | `oauth.clientId`              | Skip dynamic client registration                                                                                                                                                                                   |
| Pre-configured client secret | `--client-secret`      | —                             | Bare flag prompts for secret with masked input; `MCP_CLIENT_SECRET` env var skips the prompt (CI). Stored in system keychain (macOS) or a credentials file, not in config. Public clients: use `--client-id` alone |
| Custom auth server           | —                      | `oauth.authServerMetadataUrl` | Override autodiscovery metadata URL (must be `https://`); its `scopes_supported` overrides upstream. version >= 2.1.64                                                                                             |
| Restricted scopes            | —                      | `oauth.scopes`                | Space-separated scope string (RFC 6749 §3.3)                                                                                                                                                                       |

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
claude mcp remove <name>           # Remove a server; if name exists at multiple scopes, reports "exists in multiple scopes" — pass --scope to choose which
claude mcp reset-project-choices  # Clear project-scope approval decisions
claude mcp login <name>  # Run a configured server's OAuth flow from the shell. version >= 2.1.186
claude mcp logout <name> # Clear stored OAuth credentials for a server
```

### `/mcp` slash command

- Shows connected servers, tool counts, connection status.
- Flags servers advertising tools capability but exposing none.
- Triggers OAuth flow for servers in `⏸` state.
- "Clear authentication" revokes OAuth tokens per server.
- A remote server whose config has an empty `url` shows as `not configured` in `/mcp`, `claude mcp list`, and `/plugin`; no connection attempted (detail view: `No URL configured for this server`). Plugins use this as a placeholder for a connector configured later. version >= 2.1.208 (earlier: reported as a configuration issue with a reconnect prompt).

### Status indicators

| Status                                 | Meaning                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `✔ Connected`                          | Ready to use                                                                             |
| `! Connected · tools fetch failed`     | Connected but couldn't list tools; run `claude mcp get <name>` for the error             |
| `! Needs authentication`               | Reachable; needs OAuth sign-in or a `--header` token                                     |
| `✘ Failed to connect`                  | Server didn't respond — see the failure-detail bullet under Reconnection & startup retry |
| `✘ Connection error`                   | The connection attempt itself threw                                                      |
| `⏸ Pending approval`                   | Project-scoped server awaiting your approval                                             |
| `✘ Rejected`                           | Server blocked by `disabledMcpjsonServers`; `claude mcp get <name>` shows the message    |
| `not configured`                       | Empty `url` — no connection attempted                                                    |
| `cached <age> · connects on first use` | Remote server's tool list loaded from a prior session — see Discovery cache              |

Some legacy Windows consoles (e.g. the default Windows 10 console) render `√`/`×` instead of `✔`/`✘`.

### Disable a server without removing it

- Toggle a server off in `/mcp` — config kept, still listed as disabled, Claude Code stops connecting to it. Recorded per project in `~/.claude.json`.
- `disabledMcpServers`: opt-out list for default-on servers (user-configured, plugin, claude.ai connectors, built-in). A connector disabled via the `/mcp` toggle is written here under its display name, e.g. `claude.ai Slack`.
- `enabledMcpServers`: opt-in list for default-off built-in servers (e.g. `computer-use`).
- Exactly one list is consulted per server, so neither overrides the other; a mismatched entry is ignored. Both are disjoint from `enabledMcpjsonServers`/`disabledMcpjsonServers` in settings files, which control `.mcp.json` approval instead.

### Reserved names

- Reserved (skipped at load with a warning; `claude mcp add` rejects the name outright): `workspace`, `claude-in-chrome`, `computer-use`, `Claude Preview`, `Claude Browser`. `Claude Preview`/`Claude Browser` both name the desktop app's preview-pane server. version >= 2.1.205: `Claude Browser` became reserved (earlier, a user-configured server could take that name).

## Tool naming & permissions

### Naming conventions

| Server type                                                 | Tool name format                   |
| ----------------------------------------------------------- | ---------------------------------- |
| User-configured server `github`                             | `mcp__github__<tool>`              |
| Plugin-bundled server (plugin `my-plugin`, server key `db`) | `mcp__plugin_my-plugin_db__<tool>` |
| MCP prompt as slash command                                 | `/mcp__<servername>__<promptname>` |

- Characters outside `A-Z a-z 0-9 _ -` in plugin or server names are replaced with `_`.
- A plugin server's own registered name (distinct from its tool-name form above) is `plugin:<plugin-name>:<server-name>` — use this scoped form wherever a configured server name is expected, e.g. an `mcp_tool` hook's `server` field. A hook matcher against the bare server key (`mcp__database-tools__.*`) never fires for a plugin-bundled server — match the full `mcp__plugin_...` form instead.

### Approval

- Project-scoped servers from `.mcp.json` require one-time user approval before loading.
- Approved/rejected state stored per project; reset with `claude mcp reset-project-choices`.
- `claude mcp list`/`claude mcp get` read `.mcp.json` approvals only from settings NOT checked into the repo until the workspace-trust dialog is accepted. A freshly cloned repo can't self-approve: a committed `enableAllProjectMcpServers` or `enabledMcpjsonServers` in project `.claude/settings.json` is ignored in an untrusted folder — the server stays `⏸ Pending approval`. version >= 2.1.196
- Approvals still apply in an untrusted folder from: user `~/.claude/settings.json`, managed settings, and `--settings`-passed files.
- An untracked `.claude/settings.local.json` approves servers only after a trust dialog is accepted for that folder or a parent (the tracked-check runs git, and only in a trusted folder). Exception: your own config home — home dir, or the dir whose `.claude` is `CLAUDE_CONFIG_DIR`. version >= 2.1.207 (earlier: it approved servers in a folder never trusted).
- A `disabledMcpjsonServers` entry in any settings file always rejects the server, trusted or not.
- `claude -p`, Agent SDK runs, and Claude Code on the web can't show the interactive approval prompt — they load project-scoped servers without asking. A session started in `bypassPermissions` mode with `skipDangerousModePermissionPrompt` set also skips the prompt. Exclude a server anyway via `disabledMcpjsonServers` (blocks it in every mode) or drop project settings entirely with `--setting-sources` / the SDK's `settingSources` option.

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
- One-tap approval is withheld for such a tool on Remote Control / Agent SDK surfaces — the full prompt is shown instead. Same for any request only the terminal dialog can render in full (safety warning, always-allow option). version >= 2.1.214

### Dynamic tool discovery

- Tools discovered at session start; MCP `list_changed` notifications refresh tools/prompts/resources mid-session without reconnect.
- A failed refresh keeps the previously discovered tools/prompts/resources until a later refresh succeeds. version >= 2.1.214 (earlier: a transient error replaced them with an empty list).

### Reconnection & startup retry

- Mid-session: HTTP/SSE servers that drop reconnect with exponential backoff — up to 5 attempts, 1s initial delay, doubling. Marked failed after; retry from `/mcp`. Stdio not auto-reconnected.
- Startup: HTTP/SSE initial connection retried up to 3× on transient errors (5xx, refused, timeout). Auth/not-found errors are NOT retried. version >= 2.1.121
- Post-connection capability discovery also retries transient errors; a stalled remote tool call aborts on an idle timer — see `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` in Timeouts (env) and Version notes.
- A failed server's name + connection error is passed to Claude (including in `ToolSearch` results that match nothing), so Claude reports the failure. Requires tool search — NOT reported when tool search is off (custom `ANTHROPIC_BASE_URL`, `ENABLE_TOOL_SEARCH=false`, unsupported model) nor on Amazon Bedrock, Google Cloud's Agent Platform, or Microsoft Foundry. version >= 2.1.205 (earlier: silent — Claude could answer as if the server were never configured).
- `claude mcp list`/`claude mcp get <name>` append the failure detail (HTTP status/error code + server-returned error text) to a `✘ Failed to connect` status; credential-like text is redacted and the full URL is never shown. `✘ Connection error` gets no appended detail (the exception text could itself embed the URL). version >= 2.1.219 (earlier: bare status only, no detail).
- HTTP 404 shows `MCP endpoint not found at <origin>` in `/mcp` — origin only, no path (path was included before v2.1.219; before v2.1.191 it showed a generic `Error POSTing to endpoint`). Run `claude mcp get <name>` for the full configured URL.

### Discovery cache (remote servers)

- A remote (HTTP/SSE) server used before can show `cached <age> · connects on first use · N tools` in `/mcp`, its detail view, and `/plugin` instead of connecting at startup — Claude Code loaded its tool list from a previous session and connects the server on Claude's first call to one of its tools. Tools are available from your first message either way.
- `MCP_DISCOVERY_CACHE=0` forces every server to connect at startup instead of using the cache. version >= 2.1.221

## Tool search

- Default: MCP tool definitions are deferred — only tool names + server instructions load at session start. Claude uses a search tool to pull relevant tools on demand. No fixed per-server tool cap; budget is the context window.
- Disabled by default on Google Cloud's Agent Platform (models earlier than the Claude 4.5 generation) and when `ANTHROPIC_BASE_URL` is a non-first-party host (most proxies drop `tool_reference` blocks); set `ENABLE_TOOL_SEARCH` explicitly to override either fallback. On Google Cloud's Agent Platform, Claude Opus 4.5 / Sonnet 4.5 / Haiku 4.5 and later default to tool search on, same as the Anthropic API — before version 2.1.221 it was disabled for every GCAP model unless `ENABLE_TOOL_SEARCH=true`. Requires a model supporting `tool_reference` blocks: Claude Sonnet 4.5, Claude Haiku 4.5, Claude Opus 4.5, and later.
- Not supported on a Microsoft Foundry deployment hosted on Azure — it rejects tool search server-side; Claude Code detects the rejection and loads MCP tools upfront for that deployment instead. `ENABLE_TOOL_SEARCH` cannot override this (the rejection comes from the deployment itself, not the client). Claude starts on the tool-search path rather than `WaitForMcpServers` while Claude Code is still discovering that rejection; once switched to upfront loading, a still-connecting server's tools become available on Claude's next request.
- `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` keeps tool search off and `ENABLE_TOOL_SEARCH` cannot override it — it strips the beta header that `defer_loading` tool definitions and `tool_reference` content blocks require. An organization can keep tool search on anyway through managed settings. version >= 2.1.227
- Tool descriptions and server instructions truncate at 2KB each — keep terse, critical detail first.
- With tool search on, a needed server still connecting blocks inside the `ToolSearch` call; without it (Google Cloud's Agent Platform earlier models / custom base URL / `ENABLE_TOOL_SEARCH=false`), the `WaitForMcpServers` tool is used. With tool search on, when a server finishes connecting mid-turn, Claude Code lists its tool names to Claude on the next request in that same turn — no need to wait for the next message.
- `alwaysLoad: true` on a server (or `_meta["anthropic/alwaysLoad"]: true` on a tool) exempts it from deferral — loaded upfront every turn; also blocks startup until connected (capped at 5s connect timeout), unless the server has a valid cached entry (see Discovery cache), which supplies tools without connecting and so doesn't hold startup. Other servers connect in the background by default at startup; set `MCP_CONNECTION_NONBLOCKING=0` to make startup wait for them too.

### `ENABLE_TOOL_SEARCH`

| Value    | Behavior                                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (unset)  | All deferred, on demand; falls back to upfront on Google Cloud's Agent Platform models earlier than Claude 4.5, on a non-first-party base URL, or on a Microsoft Foundry deployment hosted on Azure                                                                                                          |
| `true`   | All deferred, except: a Microsoft Foundry deployment hosted on Azure still forces upfront loading (server-side rejection), and Google Cloud's Agent Platform models earlier than Claude 4.5 still load upfront too. Sends the beta header through proxies; fails on proxies without `tool_reference` support |
| `auto`   | Threshold: load upfront if tools fit within 10% of context window, defer overflow                                                                                                                                                                                                                            |
| `auto:N` | Threshold with custom percent `N` (0-100), e.g. `auto:5`                                                                                                                                                                                                                                                     |
| `false`  | All loaded upfront, no deferral                                                                                                                                                                                                                                                                              |

- Disable the search tool itself via `permissions.deny: ["ToolSearch"]`.

## Output limits

- Warning when any MCP tool output exceeds 10,000 tokens.
- `MAX_MCP_OUTPUT_TOKENS` env var raises the cap; default 25,000. Applies to tools without their own declared limit; image-returning tools always subject to it.
- Server authors: set `_meta["anthropic/maxResultSizeChars"]` in a tool's `tools/list` entry to raise that tool's persist-to-disk threshold for text content, up to a 500,000-char ceiling (independent of `MAX_MCP_OUTPUT_TOKENS`). Over-threshold results without the annotation are persisted to disk and replaced with a file reference.

## Timeouts (env)

| Var                                 | Controls                                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_TIMEOUT`                       | Server startup timeout in ms (default 30s)                                                                                                                                                                                                                 |
| `MCP_TOOL_TIMEOUT`                  | Default per-tool-call timeout; per-server `timeout` field overrides it. Default ~28h when unset                                                                                                                                                            |
| `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` | Idle window (ms) before aborting a tool call with no response/progress; default 5 min (HTTP/SSE/WS/connector), 30 min (stdio — version >= 2.1.203, earlier exempt); `0` disables. Not applied to IDE servers or SDK in-process servers. version >= 2.1.187 |

- Per-server `timeout` is a hard wall-clock limit per call; progress notifications do not extend it. Values < 1000 are ignored → fall through to `MCP_TOOL_TIMEOUT`. version >= 2.1.162: sub-1000 ignored (previously floored to 1s).
- A per-server `timeout` >= 1000 also floors the idle timeout — idle-abort never fires sooner than that value. version >= 2.1.203
- First-byte timer — HTTP/SSE/claude.ai-connector servers only (stdio and WS have none): a second per-request timer covering each request through to the server's first response byte. 60s unless per-server `timeout` or `MCP_TOOL_TIMEOUT` is set; setting either to >= 60s raises it to that value, a lower value does not shorten it, and an unset `MCP_TOOL_TIMEOUT`'s ~28h default never feeds it.

### Automatic backgrounding of long tool calls

- A main-conversation MCP tool call still running after 2 min moves to a background task; Claude receives the task ID immediately and the result arrives as a task notification. Listed in `/tasks` (stoppable); does not survive exiting the session. version >= 2.1.212
- Per-call limits still apply while backgrounded: per-server `timeout` / `MCP_TOOL_TIMEOUT` and `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`.
- Threshold: `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (ms); `0` turns backgrounding off. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` also turns it off, along with all other background-task features.
- Never backgrounded: subagent calls, IDE-server calls, non-interactive mode unless `CLAUDE_AUTO_BACKGROUND_TASKS=1`, and a call waiting on an open elicitation dialog (deferred until the dialog closes).

## claude.ai connectors

- Connectors added at claude.ai/customize/connectors load automatically in the CLI when signed in with that Claude.ai account; appear in `/mcp` flagged as claude.ai.
- Fetched only when the active auth method is the Claude.ai subscription — NOT when `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`, `ANTHROPIC_PROFILE`/federation vars/an active Anthropic profile, a `claude setup-token` token in `CLAUDE_CODE_OAUTH_TOKEN`, or a third-party provider (Amazon Bedrock, Google Cloud's Agent Platform) is active. Run `/status` to check; `/login` to select the Claude.ai account.
- A CLI-added server takes precedence over a connector at the same URL (connector listed hidden).
- If `/mcp` shows a connector as `connected · session token rejected` (or its detail view shows "claude.ai rejected the session token"), claude.ai rejected your Claude Code login token — usually an expired login that couldn't refresh. Re-authorizing the connector does not clear this; run `/login` to sign in again, then reconnect the connector from `/mcp`. version >= 2.1.222 (earlier: shown as needing authentication, and re-authorizing didn't resolve it).
- version >= 2.1.161: connectors never signed in to collapse behind a `Show unused connectors` row.
- version >= 2.1.162: Anthropic-hosted connectors needing claude.ai-registered redirect (Microsoft 365, Gmail, Google Calendar) cannot do local OAuth from `/mcp`; connect them at Settings → Connectors on claude.ai.
- Disable all: `disableClaudeAiConnectors: true` (any settings scope; any-source-true — a project `false` cannot re-enable a user/policy `true`) or `ENABLE_CLAUDEAI_MCP_SERVERS=false`. Block individual ones via `deniedMcpServers` by `serverName`/`serverUrl`. Servers passed via `--mcp-config` are unaffected by this setting (but allowlists/denylists still filter them — see the managed reference). On Claude Code on the web these settings do not apply (connectors arrive as `--mcp-config`, URLs rewritten through the session proxy).
- Toggle one connector off for the current project only via the `/mcp` panel — see Disable a server without removing it.
- Org per-tool controls on connectors are read at startup and enforced locally; `/mcp` shows which applies per tool. `ask` → prompt on every call with reason `Your organization requires approval for this tool`, shown even in `acceptEdits`/`auto`/`bypassPermissions`, never offering "remember", and matching allow-rules do not skip it (`dontAsk` mode denies instead). `blocked` → tool filtered out before Claude sees it. version >= 2.1.129 (earlier: settings ignored, standard permission flow).

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

| version >= | Feature                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1.64     | `oauth.authServerMetadataUrl` field                                                                                                                                                                                                                                                                                                                    |
| 2.1.121    | `alwaysLoad` field; HTTP/SSE initial connection retried up to 3× on transient errors (5xx, refused, timeout) before marking failed                                                                                                                                                                                                                     |
| 2.1.129    | Org per-tool controls (`ask` / `blocked`) on claude.ai connectors enforced locally                                                                                                                                                                                                                                                                     |
| 2.1.161    | Unused claude.ai connectors collapse behind `Show unused connectors` row                                                                                                                                                                                                                                                                               |
| 2.1.162    | Per-server `timeout` < 1000 now ignored (was floored to 1s); Anthropic-hosted connectors (M365/Gmail/Calendar) direct local-OAuth to claude.ai Settings → Connectors                                                                                                                                                                                   |
| 2.1.186    | `claude mcp login <name>` / `claude mcp logout <name>` CLI OAuth commands                                                                                                                                                                                                                                                                              |
| 2.1.187    | Remote MCP tool calls idle >5min abort via `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`                                                                                                                                                                                                                                                                         |
| 2.1.191    | Post-connection capability discovery (`tools/list`/`prompts/list`/`resources/list`) retries transient errors up to 3×; `claude mcp login` auto-detects no local browser and supports `--no-browser`; HTTP 404 shows `MCP endpoint not found at <url>` in `/mcp` (was a generic `Error POSTing to endpoint`)                                            |
| 2.1.193    | `headersHelper` auto-retries once on 401/403 with fresh headers; startup notice when a configured server needs authentication                                                                                                                                                                                                                          |
| 2.1.195    | `headersHelper` cwd = plugin root for plugin-provided servers; rejected token refresh shows a `/mcp` Re-authenticate notice; root-level `anyOf`/`oneOf`/`allOf` tool schemas are flattened instead of skipped                                                                                                                                          |
| 2.1.196    | Non-interactive (`claude -p`/Agent SDK) runs report an unauthorized server's tools as unavailable-until-authorized; `claude mcp list`/`get` restrict `.mcp.json` approval reads to untrusted-folder-safe settings sources; unset `oauth.scopes` now requests only the `WWW-Authenticate`/protected-resource scope, not the full autodiscovered catalog |
| 2.1.199    | `_meta["anthropic/requiresUserInteraction"]` tool annotation forces a permission prompt on every call                                                                                                                                                                                                                                                  |
| 2.1.202    | `url`-without-`type` config entries report a specific error naming the field (was a generic `command: expected string, received undefined`)                                                                                                                                                                                                            |
| 2.1.203    | Stdio servers get the 30-min idle timeout (previously exempt); a per-server `timeout` >= 1000 floors the idle timeout; `roots/list` includes granted additional working dirs + sends `notifications/roots/list_changed`                                                                                                                                |
| 2.1.205    | `Claude Browser` name reserved; ToolSearch surfaces a failed server's connection error to Claude (previously silent); Claude Desktop import skips only invalid names and reports each, instead of aborting the whole import                                                                                                                            |
| 2.1.206    | A `401` on an already-signed-in OAuth server refreshes the token, reconnects, and retries once (previously a transient refresh failure flagged the server for the rest of the session)                                                                                                                                                                 |
| 2.1.207    | An untracked `.claude/settings.local.json` applies its `.mcp.json` approvals only after a trust dialog for that folder or a parent (config home exempt); a plugin-provided `headersHelper` no longer substitutes `${user_config.*}` and the server is reported misconfigured                                                                           |
| 2.1.208    | A remote server with an empty `url` shows as `not configured` and is not connected (was reported as a configuration issue with a reconnect prompt)                                                                                                                                                                                                     |
| 2.1.210    | `/reload-plugins` (and an Agent SDK server-list replace that doesn't name a plugin server) keeps live connections of plugin servers whose config is unchanged (was: any unnamed plugin server disconnected)                                                                                                                                            |
| 2.1.211    | In web sessions an MCP call to a not-yet-connected plugin server starts it on demand and waits (previously failed until the next message started a turn)                                                                                                                                                                                               |
| 2.1.212    | Main-conversation MCP tool calls past 2 min auto-background to a task (`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`)                                                                                                                                                                                                                                           |
| 2.1.214    | A failed `list_changed` refresh keeps the previously discovered tools/prompts/resources (was replaced with an empty list); one-tap approval withheld for prompts only the terminal dialog can render in full                                                                                                                                           |
| 2.1.218    | The server-needs-authentication startup notice counts only servers signable-in from Claude Code (previously also counted claude.ai connectors not connected in claude.ai)                                                                                                                                                                              |
| 2.1.219    | `claude mcp list`/`get` append failure detail (status/error text, redacted) to `✘ Failed to connect` (was bare status); HTTP 404 shows the URL origin only (was the full path); `--output-format stream-json` reports a skipped `--mcp-config` entry in `system/init`'s `mcp_server_errors`                                                            |
| 2.1.221    | Remote-server discovery cache / `cached` status in `/mcp` (`MCP_DISCOVERY_CACHE=0` disables); Google Cloud's Agent Platform tool-search default now follows model generation (previously off for every GCAP model unless `ENABLE_TOOL_SEARCH=true`)                                                                                                    |
| 2.1.222    | A claude.ai connector rejected by claude.ai's session-token check shows a distinct `connected · session token rejected` state, cleared by `/login` + reconnect (previously flagged as needing authentication, which re-authorizing didn't fix)                                                                                                         |
| 2.1.227    | Managed settings can keep tool search on despite `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`                                                                                                                                                                                                                                                              |
| 2.1.229    | Bug: OAuth callback sent `http://127.0.0.1:PORT/callback` instead of `http://localhost:PORT/callback`; servers that exact-match the registered redirect URI rejected sign-in — workaround: add the `127.0.0.1` form to the server's registered redirect URIs, or upgrade to 2.1.231                                                                    |
| 2.1.231    | OAuth callback URI restored to `http://localhost:PORT/callback` (reverts 2.1.229 regression)                                                                                                                                                                                                                                                           |
