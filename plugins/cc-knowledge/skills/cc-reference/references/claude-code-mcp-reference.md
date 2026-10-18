# Claude Code MCP — Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (MCP overview, MCP quickstart, Managed MCP), verified 2026-10-09.
> Apply when configuring, authoring, or troubleshooting MCP servers in Claude Code.

## What MCP is / when to use

- MCP (Model Context Protocol) = open standard for connecting Claude Code to external tools, databases, and APIs via servers.
- Use when: you repeatedly copy data from an external tool into chat; Claude needs to read or act on a system directly (issue trackers, monitoring dashboards, databases, browsers).
- MCP servers expose **tools** (callable functions), **resources** (readable data), and **prompts** (slash-command templates).
- Server types: remote (HTTP, SSE, WebSocket) and local (stdio process).
- Find servers in the Anthropic MCP directory (claude.ai/directory), or build your own.
- Scaffold one with the official `mcp-server-dev` plugin: `/plugin install mcp-server-dev@claude-plugins-official`, then `/mcp-server-dev:build-mcp-server` — asks about your use case, scaffolds a remote HTTP or local stdio server. If the install summary says `Run /reload-plugins to apply.`, Claude Code runs the reload; if the reload warns the next message would re-read the conversation, run `/reload-plugins --force`.
- Install failure `Marketplace "claude-plugins-official" not found` → `/plugin marketplace add anthropics/claude-plugins-official`, then retry. Plugin not found in the marketplace → check the plugin name.
- Verify trust in each server before connecting it; servers that fetch external content expose prompt-injection risk.

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

- A server your organization provides via the managed `managedMcpServers` setting outranks all 5 sources above (matched by endpoint) — a duplicate anywhere in local/project/user/plugin/connector scope loses to the organization's definition. version >= 2.1.259.
- Endpoint match: two URLs are the same endpoint when they differ only in scheme/host letter case, the scheme's default port (e.g. `:443` on `https`), or a trailing slash; a different path, query string, userinfo, or non-default port makes two servers.
- Desktop app Code tab: the same stdio server name at the top level of `~/.claude.json` (user scope) and in `.mcp.json` → the Code tab uses the `~/.claude.json` definition.

### Notes

- "Local scope" stores in `~/.claude.json` (home directory) — distinct from `.claude/settings.local.json` (project directory).
- Project-scoped `.mcp.json` requires per-user approval before Claude Code loads it; reset with `claude mcp reset-project-choices`.
- Server names given to `claude mcp` commands: letters, numbers, hyphens, underscores only.
- A server's scope is fixed at add time: change it with `claude mcp remove <name> --scope <scope>`, then re-add at the new scope. Removing a remote server also deletes its stored OAuth tokens and client registration.
- A malformed `.mcp.json` entry is skipped (the others still load); `claude mcp list` shows a parse warning naming the field. `.mcp.json` is read at session start — restart the session after editing.

### Plugin-provided server lifecycle

- Session startup: Claude Code connects an enabled plugin's servers automatically. A remote (HTTP/SSE) plugin server used before may instead show a `cached` status and connect on first tool call — see Discovery cache under Reconnection & startup retry.
- `/reload-plugins` connects/disconnects a plugin's MCP servers after you enable/disable it mid-session. Reload keeps the live connection of any plugin server whose config is unchanged; an Agent SDK session that replaces the server list without naming a plugin server does the same. version >= 2.1.210 (earlier: an unnamed plugin server was disconnected).
- Moving the session with `/cd` connects the servers of plugins the new directory's settings enable and disconnects those no longer enabled — no `/reload-plugins` needed after the move. version >= 2.1.246.
- In a session without an interactive terminal, `/reload-plugins` does not connect/disconnect plugin MCP servers; the change takes effect next session.
- Plugins define servers in `.mcp.json` at the plugin root or inline under `mcpServers` in `plugin.json`. Add/remove plugin servers by installing/uninstalling the plugin, not via `/mcp`; an installed plugin server can still be toggled off in `/mcp`.
- `claude mcp get` on a plugin's stdio server prints `Command: stdio`, an empty `Args:` line, and each env var as `NAME=[REDACTED]`.

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

| Field           | Type                            | Notes                                                                                                                                                                                                        |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`          | `"http"` or `"streamable-http"` | Aliases — `streamable-http` accepted for spec compatibility                                                                                                                                                  |
| `url`           | string                          | Must use `https://` for OAuth                                                                                                                                                                                |
| `headers`       | object                          | Static key/value pairs; string values only                                                                                                                                                                   |
| `headersHelper` | string                          | Shell command (script path or inline) that prints JSON headers; see Server config schema                                                                                                                     |
| `timeout`       | number (ms)                     | Per-tool-call wall-clock timeout; see Server config schema and Timeouts (env)                                                                                                                                |
| `alwaysLoad`    | boolean                         | `true` exempts server's tools from tool-search deferral (load all upfront); `false` defers all, even tools the author marked upfront; see Tool search. version >= 2.1.121 (`false` needs version >= 2.1.287) |
| `oauth`         | object                          | OAuth config; see Authentication                                                                                                                                                                             |

- A JSON entry with `url` but no `type` is invalid (read as stdio, then skipped): `MCP server "<name>" has a "url" but no "type"; add "type": "http" (or "sse" / "ws")`. version >= 2.1.202 (earlier: generic `command: expected string, received undefined`).
- An in-process `"type": "sdk"` entry in `.mcp.json`, `~/.claude.json`, or settings is skipped (`Skipped — MCP server "<name>" declares type "sdk", which only an SDK host application can register`); only an SDK host application (Agent SDK app, desktop app) can register one.

### SSE (deprecated)

```json
{ "type": "sse", "url": "https://mcp.example.com/sse", "headers": {} }
```

- Same fields as HTTP. Prefer HTTP where available.
- `claude mcp add --transport http <name> <url>` tries HTTP first and automatically switches to SSE when the server doesn't accept it. version >= 2.1.265 (earlier: pass `--transport sse` explicitly to connect over SSE).
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

- Claude Code sets `CLAUDE_PROJECT_DIR` in spawned server environment to project root (same dir hooks receive); read it in-process (`process.env.CLAUDE_PROJECT_DIR`, `os.environ["CLAUDE_PROJECT_DIR"]`). It is the stable root — does not change when working dirs are added/removed mid-session. A server that limits its own filesystem access to allowed dirs should implement `roots/list` instead. Server may also call MCP `roots/list` — returns launch dir + every additional working dir granted via `--add-dir`/`/add-dir`/`additionalDirectories`; sends `notifications/roots/list_changed` on change. version >= 2.1.203 (earlier: launch dir only, no change notification).
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

| Field           | Type    | Required | Description                                                                                                                                                                                                                   |
| --------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`          | string  | Yes      | `http`, `streamable-http`, `sse`, or `ws`                                                                                                                                                                                     |
| `url`           | string  | Yes      | Server URL                                                                                                                                                                                                                    |
| `headers`       | object  | No       | Static headers (string values)                                                                                                                                                                                                |
| `headersHelper` | string  | No       | Shell command (script path or inline) printing JSON headers                                                                                                                                                                   |
| `timeout`       | number  | No       | Per-tool-call wall-clock timeout in ms; values < 1000 ignored → fall through to `MCP_TOOL_TIMEOUT` (default ~28h). See Timeouts (env) for the separate HTTP/SSE first-byte timer                                              |
| `alwaysLoad`    | boolean | No       | `true`: exempt from tool-search deferral; blocks startup until connected (capped at 5s connect timeout). `false`: defer every tool of the server. Valid on all server types. version >= 2.1.121 (`false`: version >= 2.1.287) |
| `oauth`         | object  | No       | OAuth config; `clientId`, `scopes`, `authServerMetadataUrl`, `callbackPort` (the client secret is a CLI flag / keychain, never a config field)                                                                                |

### Dynamic headers (`headersHelper`)

- `headersHelper` is a **string** — a script path or inline shell command. Use for non-OAuth auth (Kerberos, short-lived tokens, internal SSO).

```json
{ "headersHelper": "/opt/bin/get-mcp-auth-headers.sh" }
```

```json
{ "headersHelper": "echo '{\"Authorization\": \"Bearer '\"$(get-token)\"'\"}'" }
```

- Helper must write a JSON object of string key/value pairs to stdout.
- No output caching: runs fresh on each connection (session start and reconnect); script owns any token reuse. Runs in a shell with a 10-second timeout; cwd depends on where the server is declared — use an absolute path or a `PATH` command for portability:

| Where declared                                                                                      | Helper cwd                                                                                                          |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Plugin                                                                                              | Plugin root. version >= 2.1.195 (earlier: literal `${CLAUDE_PLUGIN_ROOT}` placeholder passed through unsubstituted) |
| Project `.mcp.json` / local-scope server                                                            | That project's directory                                                                                            |
| Agent file in project, SDK `mcpServers`/`setMcpServers()`, or `--mcp-config`                        | Session's primary working directory                                                                                 |
| User scope, managed MCP, claude.ai connector, or agent file outside the project (incl. `--add-dir`) | Config dir (`~/.claude` unless `CLAUDE_CONFIG_DIR`)                                                                 |

version >= 2.1.238 (earlier: the last row's helpers, and agent-file servers outside the project, ran from the directory Claude Code was started in instead).

- Dynamic headers override static `headers` with the same name.
- An `Authorization` header in the helper's output is used as the server's credential — no OAuth fallback. If the server rejects it (or a configured `headers.Authorization`) with 401/403 while connecting, the connection is reported failed, not flagged as needing authentication; fix the credential, then reconnect from `/mcp` to re-run the helper.
- `/cd` moves the helper's cwd only for servers that run from the session's primary working directory; a `cd` run in Bash does not move it.
- Claude Code sets `CLAUDE_CODE_MCP_SERVER_NAME` and `CLAUDE_CODE_MCP_SERVER_URL` in the helper's environment for multi-server scripts; plugin-provided servers also get `CLAUDE_PLUGIN_ROOT`.
- A `headersHelper` from a project `.mcp.json`, a plugin, or an inline agent-file server from the project/`--add-dir` runs with credential-like environment variables stripped (any name containing `TOKEN`/`SECRET`/`PASSWORD`/`KEY`/`AUTH`, case-insensitive, except Git's `GIT_CONFIG_KEY_<n>`, plus a fixed list e.g. `ANTHROPIC_CUSTOM_HEADERS`) — read secrets from a file/credential store instead. A server at user/local scope, managed MCP, a claude.ai connector, supplied by the SDK/`--mcp-config`, or an inline agent-file server from `~/.claude/agents/`, managed settings, or `--agents` keeps them. If a stripped var was expanded into the server's `url`, the helper's `CLAUDE_CODE_MCP_SERVER_URL` shows `REDACTED` in its place.
- Executes arbitrary shell. For a project- or local-scope server, runs only after the trust dialog is accepted for the exact project directory the server is declared in — a parent folder's trust, and a `claude -p`/SDK session's automatic hook-trust, don't count. Until trusted: connects with static `headers` alone; a `claude -p`/SDK run also prints one `headersHelper not run` stderr line per server. version >= 2.1.238 (earlier: a `claude -p`/SDK session ran the helper regardless of trust; an interactive session ran it once any parent folder was trusted).
- Trust without a dialog: set `projects["<path>"].hasTrustDialogAccepted` to `true` in `~/.claude.json`. An inline server in an agent file from the project or an `--add-dir` directory is not loaded at all until that project/directory itself is trusted, so its helper never runs.
- A tool call returning 401/403 auto-reruns the helper, reconnects with fresh headers, and retries once; the server is flagged needing authentication in `/mcp` only if that retry also fails. version >= 2.1.193
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

### Credential variables that read as empty

- In a remote server's `url` and `headers` only, a `${VAR}` reference to a credential-like name expands to empty instead of its value — stops a project `.mcp.json` or a plugin from forwarding your credentials to a server it names. Covered: Claude Code's own (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`), your cloud provider's (`AWS_BEARER_TOKEN_BEDROCK`), and other environment credentials (`HTTPS_PROXY`, `NPM_TOKEN`). `"Bearer ${ANTHROPIC_AUTH_TOKEN}"` sends `Bearer` with no token — usually a `401`. A covered name reads as empty whether or not it's set; a `${VAR:-default}` fallback on it is ignored too.
- A provider base URL var (e.g. `ANTHROPIC_BASE_URL`) still expands normally unless its own value embeds a credential (e.g. a username:password in the URL).
- A name outside the covered set (e.g. `API_KEY`) expands as written — copy a covered credential into a differently-named var to pass it through.
- Claude Code logs a referenced covered variable to a `never expanded toward a remote server` debug-log line (`claude --debug-file /tmp/claude-debug.log`).
- version >= 2.1.268: a server's `/mcp` detail view shows a `${VAR}` reference in its URL/command by name, not its resolved value — same as `claude mcp list`/`get` output (local/project/user scope only). A server from `managedMcpServers` shows the URL's host only on these surfaces instead.

### Root-level schema combinators

- Tool input schema with a top-level `anyOf`/`oneOf`/`allOf` (API rejects combinators at schema root, only nested inside `properties`) → Claude Code flattens it to one object and prepends a sentence to the tool description naming which params group together. `allOf`: each branch's `required` still enforced. `anyOf`/`oneOf`: `required` is described in text, not schema-enforced — server must still validate. version >= 2.1.195 (earlier, and on deployments without the rewrite e.g. offline: tool is skipped entirely, reason logged; other tools on the server stay available).

### Invalid input schemas

- Checked after the combinator rewrite above, on the schema Claude Code would actually send. A tool is excluded (not sent to the API) when either check fails: top-level property names must be 1-64 chars, ASCII letters/digits/`_`/`.`/`-` only; the schema must validate against the JSON Schema draft 2020-12 meta-schema (checked when `$schema` is unset or names 2020-12 — a schema declaring another dialect skips only this second check, the property-name check still applies).
- Excluded tool: reason logged to the server's log; Claude is told which tools were excluded and why. The server's other tools stay available; fixing the schema server-side restores the tool on the next load.
- Feature-flag gated. version >= 2.1.216 (earlier: no deployment ran these checks — a malformed schema made the API reject every request that included the tool with a 400). On a deployment with feature-flag fetching off, or that has never received flags (e.g. air-gapped): still logs which tool would be rejected, but sends it to the API anyway, which 400s the whole request naming the tool by position.

### Configuration warnings

- Claude Code checks `command`, `url`, each `args` entry, and the keys/values under `env` and `headers` for hidden leading/trailing whitespace (a common artifact of pasting a token with a trailing newline). Shown in `claude mcp list` output and in `/mcp`, naming only the affected field, e.g. `Leading or trailing whitespace in: headers.Authorization` — never echoes the value. Claude Code does not trim it; edit the config to remove it.
- Same server name defined at more than one scope with different endpoints → warns of the conflict in `claude mcp list` and `/mcp` (OAuth sign-ins are stored per endpoint, so authenticating one scope's definition doesn't cover another's). Quotes each scope's endpoint with `${VAR}` references left unexpanded — never a resolved secret. Resolve by removing the extras: `claude mcp remove <name> --scope <scope>`.

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
- Startup notice lists configured servers needing authentication. version >= 2.1.193; version >= 2.1.218 counts only servers signable-in from Claude Code (earlier it also counted claude.ai connectors, which can only be connected in claude.ai). The notice announces each server once and leaves it out of the count at later launches until that server has connected and needs sign-in again; `/mcp` still lists every server needing sign-in.
- `claude mcp login <name>` (see Management commands) also runs this flow from the shell. When the server rejects the stored refresh token, Claude Code immediately shows a notice pointing at `/mcp`: select **Re-authenticate** on the server before the next tool call fails (see also Version notes).
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

- The client secret can be set only when adding the server. `claude mcp login` and `/mcp` use the stored secret and neither prompt for one nor read `MCP_CLIENT_SECRET`. To add/change it: `claude mcp remove <name>`, then re-add with `--client-secret` and the same `--scope`. `claude mcp get <name>` verifies OAuth credentials are configured.

Scope rules:

- `oauth.scopes` takes precedence over `authServerMetadataUrl` and `/.well-known`-discovered scopes. Unset, version >= 2.1.196: requests only the scope named in the server's `WWW-Authenticate` header or protected-resource metadata, no `scope` param sent if neither provides one — no longer requests the full autodiscovered `scopes_supported` catalog (that caused `invalid_scope` on IdPs advertising admin-only/template scopes). A configured `authServerMetadataUrl`'s `scopes_supported` is still requested in full.
- If the auth server advertises `offline_access`, it is appended so tokens refresh without re-sign-in.
- A 403 `insufficient_scope` fails the call with a `needs additional permissions` message naming the scope the server asks for, and `/mcp` shows the server as needing authentication. Re-authenticating requests the pinned scopes, not the named one — add the scope to `oauth.scopes` first, then re-authenticate.

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

- Short forms: `-s`/`--scope`, `-e`/`--env`, `-t`/`--transport`, `-H`/`--header`. `--env` takes multiple `KEY=value` pairs; a server name placed directly after `--env` is read as another pair, so put another option (e.g. `--transport stdio`) between `--env` and the name.
- Success prints an `Added ...` line (e.g. `Added HTTP MCP server <name> with URL: <url> to local config`) followed by a `File modified:` line naming the config file written (config written, not proof the server connects); verify with `claude mcp get <name>` or `claude mcp list`. `claude mcp remove` likewise prints `Removed MCP server "<name>" from local config` + a `File modified:` line.
- A `was not saved` / `may not have been saved` message instead of `Added ...` → see the official errors page entries `MCP server was not saved or removed` / `MCP server may not have been saved or removed`.
- A failure status in `claude mcp list` means Claude Code couldn't connect to that server, not that the list command failed.
- A stdio server run via `npx` can show `✘ Failed to connect` on the first check while the package downloads; retry after a moment.

### Setup instructions written for another client

| Instructions give        | Run                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://` URL           | `claude mcp add --transport http <name> <url>` (SSE endpoint: same command — auto-switches, version >= 2.1.265 — or `--transport sse`)                                          |
| `wss://` URL             | `claude mcp add-json` with `"type":"ws"` (`--transport` rejects `ws`)                                                                                                           |
| Launch command (`npx …`) | `claude mcp add <name> --env KEY=value -- <command> [args]` — whole command after `--` so flags like `-y` reach the server                                                      |
| `mcpServers` JSON block  | `claude mcp add-json <name> '<entry object>'` — pass the inner entry, not the wrapper; add `"type"` to any `url` entry; pick a name of only letters/numbers/hyphens/underscores |

- Each command writes local scope unless `--scope project` / `--scope user` is passed.

### `claude mcp add-json`

```bash
claude mcp add-json my-server '{"type":"ws","url":"wss://example.com/socket"}'
```

- Accepts full JSON server entry; use for WebSocket or complex configs. Pass the entry object, not the `mcpServers` wrapper; a `url` entry needs an explicit `type` (`http`/`sse`/`ws`). Takes `--scope` and `--client-secret`. Fix only the OAuth callback port (dynamic client registration otherwise): `'{"type":"http","url":"<url>","oauth":{"callbackPort":8080}}'`; with pre-configured credentials add `"clientId"` in `oauth` and pass `--client-secret` as a separate flag.

### Management commands

```bash
claude mcp list          # List all configured servers (shows ⏸ Pending / ⊘ Disabled; ✘ Rejected appears only in get)
claude mcp get <name>    # Show details for one server
claude mcp remove <name>           # Remove a server; if name exists at multiple scopes, reports "exists in multiple scopes" — pass --scope to choose which
claude mcp reset-project-choices  # Clear project-scope approval decisions
claude mcp login <name>  # Run a configured server's OAuth flow from the shell. version >= 2.1.186
claude mcp logout <name> # Clear stored OAuth credentials for a server
```

- `claude mcp login` with no local browser (SSH, Linux without a display server) prints the authorization URL; open it locally and paste the full redirect URL back at the prompt (needs an interactive terminal — connect with `ssh -t`). `--no-browser` forces the URL prompt even when a browser is detected.
- Before v2.1.285, `claude mcp get` printed no `Command` line for a stdio entry saved without a `type` field (e.g. a hand-written `.mcp.json` entry); `claude mcp list` prints the command line either way.

### `/mcp` slash command

- Shows connected servers, tool counts, connection status.
- Flags servers advertising tools capability but exposing none.
- Triggers OAuth flow for servers in `⏸` state.
- "Clear authentication" revokes OAuth tokens per server.
- `/mcp reconnect all` retries every server that failed or needs authentication. In the interactive terminal needs version >= 2.1.284 (earlier: `MCP server "all" not found`).
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
| `⊘ Disabled for this project`          | Server turned off for this project via `/mcp` (see Disable a server without removing it) |
| `cached <age> · connects on first use` | Remote server's tool list loaded from a prior session — see Discovery cache              |

Some legacy Windows consoles (e.g. the default Windows 10 console) render `√`/`×` instead of `✔`/`✘`.

- Full status text: ``⏸ Pending approval (run `claude` to approve)`` (project `.mcp.json` server not yet approved; run `claude` interactively to review), `✘ Rejected (see disabledMcpjsonServers in settings)`, `⊘ Disabled for this project (re-enable via /mcp)` (server named by the project's `disabledMcpServers` list; turn back on from `/mcp`).
- `⏸ Pending approval`, `✘ Rejected`, and `⊘ Disabled for this project` report a configuration decision, not a connection attempt — `claude mcp list`/`get` print them without connecting to the server (`✘ Rejected` shows only in `claude mcp get`). version >= 2.1.238 (earlier: both commands connected to a disabled server to health-check it and reported the connection result instead).

### Disable a server without removing it

- Toggle a server off in `/mcp` — config kept, still listed as disabled, Claude Code stops connecting to it. Recorded per project in `~/.claude.json`.
- `disabledMcpServers`: opt-out list for default-on servers (user-configured, plugin, organization-provided via managed settings, claude.ai connectors, built-in). A connector disabled via the `/mcp` toggle is written here under its display name, e.g. `claude.ai Slack`.
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
- MCP prompts are listed as `/servername:promptname (MCP)`; `/mcp__servername__promptname` also runs them. Arguments are space-separated and split on whitespace (one token each). In the `/mcp__...` form, characters outside `A-Z a-z 0-9 _ -` in the server name become `_`; the prompt name is used as declared.
- Prompts from a server named `anthropic-skills` are not listed (name reserved for skills synced from claude.ai); its tools still work — rename the server to list its prompts.

### Approval

- Project-scoped servers from `.mcp.json` require one-time user approval before loading.
- Approved/rejected state stored per project; reset with `claude mcp reset-project-choices`.
- `claude mcp list`/`claude mcp get` read `.mcp.json` approvals only from settings NOT checked into the repo until the workspace-trust dialog is accepted. A freshly cloned repo can't self-approve: a committed `enableAllProjectMcpServers` or `enabledMcpjsonServers` in project `.claude/settings.json` is ignored in an untrusted folder — the server stays `⏸ Pending approval`. version >= 2.1.196
- Approvals still apply in an untrusted folder from: user `~/.claude/settings.json`, managed settings, and `--settings`-passed files.
- An untracked `.claude/settings.local.json` approves servers only after a trust dialog is accepted for that folder or a parent (the tracked-check runs git, and only in a trusted folder). Exception: your own config home — home dir, or the dir whose `.claude` is `CLAUDE_CONFIG_DIR`. version >= 2.1.207 (earlier: it approved servers in a folder never trusted).
- A `disabledMcpjsonServers` entry in any settings file always rejects the server, trusted or not.
- `claude -p`, Agent SDK runs, and Claude Code on the web can't show the interactive approval prompt — they load project-scoped servers without asking. A session started in `bypassPermissions` mode with `skipDangerousModePermissionPrompt` set in user or managed settings also skips the prompt. Exclude a server anyway via `disabledMcpjsonServers` (blocks it in every mode), drop project settings entirely with `--setting-sources` / the SDK's `settingSources` option, or start with `--strict-mcp-config` (uses only servers passed via `--mcp-config`). version >= 2.1.246: `--strict-mcp-config` also skips the approval wait for project-scoped servers it isn't loading anyway (earlier: a strict session still waited on their approval, stalling a background/non-interactive session at startup).

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

- Server sets `_meta["anthropic/requiresUserInteraction"]: true` on a tool's `tools/list` entry (must be the JSON boolean `true`; any other value is ignored) → permission prompt shown on every call, even in `acceptEdits`/`auto`/`bypassPermissions` modes; no "don't ask again"; matching allow-rules don't skip it; `dontAsk` mode denies instead of prompting. Non-interactive `--permission-prompt-tool` allow results are converted to deny (`MCP tool requires user interaction; not supported via --permission-prompt-tool`); Agent SDK `canUseTool` still receives the call. version >= 2.1.199
- One-tap approval is withheld for such a tool on Remote Control / Agent SDK surfaces — the full prompt is shown instead. Same for any request only the terminal dialog can render in full (safety warning, always-allow option). version >= 2.1.214

### Dynamic tool discovery

- Tools discovered at session start; MCP `list_changed` notifications refresh tools/prompts/resources mid-session without reconnect in an interactive terminal session. In `claude -p` and the Agent SDK only the tool list refreshes.
- A failed refresh keeps the previously discovered tools/prompts/resources until a later refresh succeeds. version >= 2.1.214 (earlier: a transient error replaced them with an empty list).

### Reconnection & startup retry

- Mid-session: HTTP/SSE servers that drop reconnect with exponential backoff — up to 5 attempts, 1s initial delay, doubling. Marked failed after; retry from `/mcp`. Stdio not auto-reconnected. Interactive: `/mcp` shows the server pending while reconnecting; after 5 failures it is marked failed (or needing authentication when it needs authorizing again) with notice `MCP server "<name>" disconnected · open /mcp to reconnect`. `claude -p`/Agent SDK reconnect on the same schedule.
- Startup: HTTP/SSE initial connection retried up to 3× on transient errors (5xx, refused, timeout). Auth/not-found errors are NOT retried, and a WebSocket server's first connection is not retried. Exception: when a `headersHelper` is the server's only source of `Authorization`, an auth error is retried (the helper re-runs each attempt). version >= 2.1.121
- Resumed session: a call to a tool from the saved conversation whose server is on its first connection attempt is held up to 10s; if the server doesn't connect in time (or is already retrying after a failure), the call fails with `No such tool available`.
- Post-connection capability discovery (`tools/list`/`prompts/list`/`resources/list`) retries up to 3× with short backoff on transient network/server errors — not on auth errors, 4xx responses, or request timeouts; a stalled remote tool call aborts on an idle timer — see `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` in Timeouts (env) and Version notes.
- A failed server's name + connection error is passed to Claude (including in `ToolSearch` results that match nothing), so Claude reports the failure. Requires tool search — NOT reported when tool search is off (custom `ANTHROPIC_BASE_URL`, `ENABLE_TOOL_SEARCH=false`, unsupported model) nor on Amazon Bedrock, Google Cloud's Agent Platform, or Microsoft Foundry. version >= 2.1.205 (earlier: silent — Claude could answer as if the server were never configured).
- `claude mcp list` appends the failure detail (HTTP status/error code + server-returned error text) to a `✘ Failed to connect` status line; `claude mcp get <name>` shows it on an `Issue:` line and the server's `/mcp` detail view in its `Issue:` row; credential-like text is redacted and the full URL is never shown. `✘ Connection error` gets no appended detail (the exception text could itself embed the URL). version >= 2.1.219 (earlier: bare status only, no detail). After completing authentication from `/mcp`, a connection that still fails with an HTTP status or transport error code adds that code and the URL's origin (scheme + host, port if named; never path/query; a `${VAR}` in the host is not expanded) to the printed message.
- HTTP 404 shows `MCP endpoint not found at <origin>` in `/mcp` — origin only, no path (path was included before v2.1.219; before v2.1.191 it showed a generic `Error POSTing to endpoint`). Run `claude mcp get <name>` for the full configured URL.

## MCP client runtime (v1/v2)

- Two runtimes: v1 (MCP TypeScript SDK 1.x) and v2 (SDK 2.0, adds MCP protocol revision 2026-07-28). Picked once per session start, kept until exit.
- version >= 2.1.232: v2 is the default in a session that fetches feature flags. version >= 2.1.274: v2 also becomes the default in a session that doesn't fetch feature flags — Amazon Bedrock / Claude Platform on AWS / Google Cloud's Agent Platform / Microsoft Foundry sessions (unless a host embedding Claude Code sets `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`), sessions signed in through a Claude apps gateway, and sessions with telemetry/feature-flag fetching off (e.g. `DISABLE_TELEMETRY`). Before 2.1.274 those sessions used v1.
- On v2: asks HTTP, stdio, and claude.ai-connector servers whether they support the newer protocol revision and uses it with those that do; every other server connects as on v1. `MCP_PROTOCOL_NEGOTIATION=legacy` keeps every server on the earlier handshake. Anthropic can keep a specific server on the earlier protocol, or off the notification stream, via a feature flag Claude Code fetches. `list_changed` notifications from a server on the newer revision arrive over a stream Claude Code holds open, instead of polling.
- A channel server (`claude/channel` capability) that negotiates the newer revision on v2 is NOT registered as a channel — that revision can't carry channel messages. A channel server that doesn't support the revision connects on the earlier handshake and registers as before. Claude Code asks stdio servers for the revision by default; set `MCP_PROTOCOL_NEGOTIATION=legacy` to keep a stdio channel server on the earlier handshake.
- v2 fails an OAuth sign-in whose authorization response names an unexpected issuer.
- v2 sends MCP OAuth credentials only to a token endpoint served over HTTPS or at `localhost`/`127.0.0.1`/`::1`; sign-in fails for a plain `http://` token endpoint anywhere else (e.g. a LAN device).
- On connections using protocol revision 2026-07-28, Claude Code declares `elicitation: {form: {}, url: {}}` in its client capabilities.
- Notification-stream reopening (v2, newer-revision servers): closes again within 10s → reopens up to 3× then stops for that connection; stays open >10s then closes (common for serverless hosts) → after 5 reopens in an hour, waits ~6h before the next. Until it reopens, tools/prompts/resources stay at their last-fetched state; reconnect the server from `/mcp` to refresh sooner.
- `MCP_SDK_GENERATION=v1`/`v2` pins the runtime. `MCP_PROTOCOL_NEGOTIATION=auto`/`legacy` decides whether Claude Code asks a server for the newer revision (`legacy` = never ask).

### Discovery cache (remote servers)

- A remote (HTTP/SSE) server used before can show `cached <age> · connects on first use · N tools` in `/mcp`, its detail view, and `/plugin` instead of connecting at startup — Claude Code loaded its tool list from a previous session and connects the server on Claude's first call to one of its tools. Tools are available from your first message either way.
- Off by default unless a gradual rollout has enabled it for the account. `MCP_DISCOVERY_CACHE=1` forces it on; `=0` forces it off even when the rollout enabled it. version >= 2.1.221 (introduces the cache + `cached` status); version >= 2.1.238: default flipped to off-unless-rolled-out (earlier: on by default).
- In a server's `/mcp` menu: Reconnect on a `cached` server connects it now and keeps the cache entry; on a connected/failed server it reconnects and discards the entry. Disable and Clear authentication also discard the entry. After discarding, tools are fetched live, not from cache.

## Tool search

- Default: MCP tool definitions are deferred — only tool names + server instructions load at session start. Claude uses a search tool to pull relevant tools on demand. No fixed per-server tool cap; budget is the context window.
- Disabled by default when `ANTHROPIC_BASE_URL` is a non-first-party host (most proxies drop `tool_reference` blocks); set `ENABLE_TOOL_SEARCH` explicitly to override that fallback. Google Cloud's Agent Platform models earlier than the Claude 4.5 generation always load MCP tools upfront (their serving stacks reject the required beta header) — `ENABLE_TOOL_SEARCH=true` does not override it. On Google Cloud's Agent Platform, Claude Opus 4.5 / Sonnet 4.5 / Haiku 4.5 and later default to tool search on, same as the Anthropic API — before version 2.1.221 it was disabled for every GCAP model unless `ENABLE_TOOL_SEARCH=true`. Requires a model supporting `tool_reference` blocks: Claude Sonnet 4.5, Claude Haiku 4.5, Claude Opus 4.5, and later.
- Not supported on a Microsoft Foundry deployment hosted on Azure — it rejects tool search server-side; Claude Code detects the rejection and loads MCP tools upfront for that deployment instead. `ENABLE_TOOL_SEARCH` cannot override this (the rejection comes from the deployment itself, not the client). Claude starts on the tool-search path rather than `WaitForMcpServers` while Claude Code is still discovering that rejection; once switched to upfront loading, a still-connecting server's tools become available on Claude's next request.
- `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` keeps tool search off and `ENABLE_TOOL_SEARCH` cannot override it — it strips the beta header that `defer_loading` tool definitions and `tool_reference` content blocks require. An organization can keep tool search on anyway through managed settings. version >= 2.1.227
- Tool descriptions and server instructions each truncate at 2,048 characters by default — keep terse, critical detail first. `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` (characters) changes the limit for every MCP server in the session. version >= 2.1.280
- With tool search on, a needed server still connecting blocks inside the `ToolSearch` call; without it (Google Cloud's Agent Platform earlier models / custom base URL / `ENABLE_TOOL_SEARCH=false`), the `WaitForMcpServers` tool is used. With tool search on, when a server finishes connecting mid-turn, Claude Code lists its tool names to Claude on the next request in that same turn — no need to wait for the next message.
- `alwaysLoad: true` on a server exempts all its tools from deferral — loaded upfront every turn regardless of `ENABLE_TOOL_SEARCH`; field valid on all server types. Use only for a few tools Claude needs every turn (each upfront tool consumes context). It also blocks startup until connected (capped at the 5s connect timeout), unless the server has a valid cached entry (see Discovery cache), which supplies tools without connecting and so doesn't hold startup.
- Per-tool `_meta["anthropic/alwaysLoad"]` (server authors) — the person configuring the server can override it with the server-level `alwaysLoad`:

| Tool `_meta` value | Effect                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `true`             | Tool loads upfront; startup does not wait for the server because of this value. Server-level `"alwaysLoad": false` defers it anyway                                                                                                       |
| `false`            | Tool stays deferred when the server's config sets `"alwaysLoad": true` — applies to servers passed via `--mcp-config`, supplied by an Agent SDK app, or provided by a plugin; on other servers the tool loads upfront. version >= 2.1.285 |

- Server-level `"alwaysLoad": false` defers every tool of the server, including tools the author marked upfront; leaving `alwaysLoad` out lets author-marked tools load upfront. version >= 2.1.287.
- Server authors: write clear server instructions (task categories the tools handle, when Claude should search for them, key capabilities) — they steer tool search the way skill descriptions do. Other servers connect in the background by default at startup; set `MCP_CONNECTION_NONBLOCKING=0` to make startup wait for them too.

### `ENABLE_TOOL_SEARCH`

| Value    | Behavior                                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (unset)  | All deferred, on demand; falls back to upfront on Google Cloud's Agent Platform models earlier than Claude 4.5, on a non-first-party base URL, or on a Microsoft Foundry deployment hosted on Azure                                                                                                          |
| `true`   | All deferred, except: a Microsoft Foundry deployment hosted on Azure still forces upfront loading (server-side rejection), and Google Cloud's Agent Platform models earlier than Claude 4.5 still load upfront too. Sends the beta header through proxies; fails on proxies without `tool_reference` support |
| `auto`   | Threshold: tools Claude Code would otherwise defer load upfront while their definitions total less than 10% of the context window; all are deferred once they reach 10%                                                                                                                                      |
| `auto:N` | Threshold with custom percent `N` (0-100), e.g. `auto:5`                                                                                                                                                                                                                                                     |
| `false`  | All loaded upfront, no deferral                                                                                                                                                                                                                                                                              |

- Disable the search tool itself via `permissions.deny: ["ToolSearch"]`.

## Output limits

- Warning when any MCP tool output exceeds 10,000 tokens.
- `MAX_MCP_OUTPUT_TOKENS` env var raises the cap; default 25,000. Applies to tools without their own declared limit; image-returning tools always subject to it.
- Over the limit (no image content): Claude Code persists the result to a file under the session's `tool-results` directory in `~/.claude/projects/` and replaces it in the conversation with a message naming that file path — Claude reads the file when it needs the content.
- Images: PNG/JPEG/GIF/WebP results show inline (the inline copy may be scaled down or compressed to fit the model's image limits); the original bytes are also saved under the session's `tool-results` directory in `~/.claude/projects/` and the path is given to Claude (crop/convert/reuse via Bash). `--no-session-persistence` or `CLAUDE_CODE_SKIP_PROMPT_HISTORY` → no file, inline copy only. Saving the file needs version >= 2.1.283.
- Character limit for text results (separate from the token cap): for a tool without `anthropic/maxResultSizeChars`, a successful result with no image content is saved to a file once longer than 50,000 characters, whatever its token count; `MAX_MCP_OUTPUT_TOKENS` does not change that threshold. A call moved to a background task reports its result through the task notification instead.
- Error results: a result marked `isError: true` reaches Claude as the error message; text longer than about 11,000 characters keeps only its first 5,000 and last 5,000 characters, with a marker between them stating how many characters were removed.
- Response size from HTTP/SSE servers: Claude Code stops reading once one JSON response body, or one event of an event stream, passes 16 MB after decompression; the request that response answers fails. Server authors: paginate to stay under the limit.
- Server authors: set `_meta["anthropic/maxResultSizeChars"]` in a tool's `tools/list` entry to raise that tool's persist-to-disk threshold (default 50,000 chars) for text content, up to a 500,000-char ceiling (independent of `MAX_MCP_OUTPUT_TOKENS`; image tools still subject to the token limit). Over-threshold results without the annotation are persisted to disk and replaced with a file reference.

## Timeouts (env)

| Var                                 | Controls                                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_TIMEOUT`                       | Server startup timeout in ms (default 30s)                                                                                                                                                                                                                 |
| `MCP_TOOL_TIMEOUT`                  | Default per-tool-call timeout; per-server `timeout` field overrides it. Default ~28h when unset                                                                                                                                                            |
| `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` | Idle window (ms) before aborting a tool call with no response/progress; default 5 min (HTTP/SSE/WS/connector), 30 min (stdio — version >= 2.1.203, earlier exempt); `0` disables. Not applied to IDE servers or SDK in-process servers. version >= 2.1.187 |

- Per-server `timeout` is a hard wall-clock limit per call; progress notifications do not extend it. Values < 1000 are ignored → fall through to `MCP_TOOL_TIMEOUT`. version >= 2.1.162: sub-1000 ignored (previously floored to 1s).
- A per-server `timeout` >= 1000 also floors the idle timeout — idle-abort never fires sooner than that value. version >= 2.1.203
- First-byte timer — HTTP/SSE/claude.ai-connector servers only (stdio and WS have none): a second per-request timer covering each request through to the server's first response byte. Set to the greatest of: 60s, the tool timeout that applies to the server (per-server `timeout` else `MCP_TOOL_TIMEOUT`), and `MCP_TIMEOUT`; a value below 60s never shortens it, and an unset `MCP_TOOL_TIMEOUT`'s ~28h default never enters the comparison.

### Automatic backgrounding of long tool calls

- A main-conversation MCP tool call still running after 2 min moves to a background task; Claude receives the task ID immediately and the result arrives as a task notification. Listed in `/tasks` (stoppable; the entry shows the latest progress the server reported); does not survive exiting the session. version >= 2.1.212
- Per-call limits still apply while backgrounded: per-server `timeout` / `MCP_TOOL_TIMEOUT` and `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`.
- Threshold: `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (ms); `0` turns backgrounding off. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` also turns it off, along with all other background-task features.
- Never backgrounded: subagent calls, IDE-server calls, non-interactive mode unless `CLAUDE_AUTO_BACKGROUND_TASKS=1`, and a call waiting on an open elicitation dialog (deferred until the dialog closes).

## claude.ai connectors

- Connectors added at claude.ai/customize/connectors load automatically in the CLI when signed in with that Claude.ai account; appear in `/mcp` flagged as claude.ai.
- Fetched only when the active auth method is the Claude.ai subscription — NOT when `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`, `ANTHROPIC_PROFILE`/federation vars/an active Anthropic profile, a `claude setup-token` token in `CLAUDE_CODE_OAUTH_TOKEN`, or a third-party provider (Amazon Bedrock, Google Cloud's Agent Platform) is active. Run `/status` to check; `/login` to select the Claude.ai account.
- A CLI-added server takes precedence over a connector at the same URL (connector listed hidden).
- On Team and Enterprise plans only admins can add connectors at claude.ai/customize/connectors.
- Anthropic-provided connector `claude.ai Claude Docs` appears in `/mcp` with no setup on accounts where Claude Docs is available, and Claude uses it when you ask for a document meant for other people; turn it off with a `deniedMcpServers` `serverName` entry of `"claude.ai Claude Docs"` or the `/mcp` toggle.
- A connector is marked `managed` in `/mcp` and `/plugin` when the organization manages its authentication in claude.ai; this doesn't change how Claude Code connects or applies tool controls.
- If a temporary network problem keeps the connector list from loading at startup, Claude Code retries the fetch up to 3× in the background; if connectors still don't appear, restart Claude Code.
- If `/mcp` shows a connector as `connected · session token rejected` (or its detail view shows "claude.ai rejected the session token"), claude.ai rejected your Claude Code login token — usually an expired login that couldn't refresh. Re-authorizing the connector does not clear this; run `/login` to sign in again, then reconnect the connector from `/mcp`. version >= 2.1.222 (earlier: shown as needing authentication, and re-authorizing didn't resolve it).
- version >= 2.1.161: connectors never signed in to collapse behind a `Show unused connectors` row at the end of the claude.ai section (select it to expand); a connector signed in before stays visible even when it currently needs re-authentication.
- version >= 2.1.162: Anthropic-hosted connectors needing claude.ai-registered redirect (Microsoft 365, Gmail, Google Calendar) cannot do local OAuth from `/mcp`; connect them at Settings → Connectors on claude.ai. Signing in from `/mcp` or `claude mcp login` to a server added via `claude mcp add`/`.mcp.json` that points at one of these hosts shows `is Anthropic-hosted and doesn't support local OAuth`; remove your entry with `claude mcp remove <name>` and connect the service at claude.ai/customize/connectors; the connector then appears automatically.
- Disable all: `disableClaudeAiConnectors: true` (any settings scope; any-source-true — a project `false` cannot re-enable a user/policy `true`) or `ENABLE_CLAUDEAI_MCP_SERVERS=false`. Block individual ones via `deniedMcpServers` by `serverName`/`serverUrl`. Servers passed via `--mcp-config` are unaffected by this setting (but allowlists/denylists still filter them — see the managed reference). On Claude Code on the web these settings do not apply (connectors arrive as `--mcp-config`, URLs rewritten through the session proxy).
- Toggle one connector off for the current project only via the `/mcp` panel — see Disable a server without removing it.
- `disableClaudeAiConnectors`, `ENABLE_CLAUDEAI_MCP_SERVERS` and `allowAllClaudeAiMcps` act only on connectors Claude Code fetches itself (terminal, VS Code, JetBrains, Agent SDK sessions). Cloud sessions receive connectors from the cloud host: governed by claude.ai org settings plus `allowedMcpServers`/`deniedMcpServers` that reach the session (the session proxy rewrites each connector URL, so a `serverUrl` pattern for the original URL doesn't match); delivered connectors are dropped when a `managed-mcp.json` exists on the host running the session, even with `allowAllClaudeAiMcps`; no sign-in flow runs there — reconnect at claude.ai/customize/connectors.
- Desktop app local and SSH sessions get connectors as in-process `type: "sdk"` servers that no MCP setting or `managed-mcp.json` reaches (a user disconnects a connector at claude.ai/customize/connectors; an organization blocks a connector's tools or turns off Claude Code in the desktop app). Desktop app WSL sessions have no connectors yet.
- Org per-tool controls on connectors are read at startup and enforced locally; `/mcp` shows which applies per tool. `ask` → prompt on every call with reason `Your organization requires approval for this tool`, shown even in `acceptEdits`/`auto`/`bypassPermissions`, never offering "remember", and matching allow-rules do not skip it (`dontAsk` mode denies instead). `blocked` → tool filtered out before Claude sees it. version >= 2.1.129 (earlier: settings ignored, standard permission flow). In the desktop app's local/SSH sessions the desktop app withholds `blocked` tools before delivery and `ask` doesn't reach Claude Code (the session's ordinary permission rules apply instead); in sessions that fetch connectors themselves, `/mcp` shows a blocked tool marked `disabled by your organization`.

## Troubleshooting

| Symptom                                            | Cause / fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/mcp` shows `No MCP servers configured`           | Local-scope servers are tied to the project where added (repo root, or the exact directory outside a repository) — re-add from the right project or use `--scope user`. Claude Code reads only `~/.claude.json` and `<project>/.mcp.json`, not paths such as `~/.claude/.mcp.json`, `~/.claude/config/mcp.json`, `~/.claude/mcp.json`, or `%APPDATA%/Claude/mcp.json`. A malformed `.mcp.json` entry is skipped (others load) — look for the parse warning in `claude mcp list` |
| `Failed to connect` / `Connection error`           | Server didn't start or the URL didn't respond; also shown for an HTTP server that rejects a configured `headers.Authorization` (a server wanting a token you haven't configured shows `! Needs authentication`). Check `claude mcp list` for hidden-whitespace warnings; for stdio, run the configured command directly; a `claude mcp get` command that differs from what you typed means the `--` separator was omitted                                                       |
| `MCP server <name> already exists in local config` | Same name at the same scope — remove the entry first or pick another name; `remove` reporting `exists in multiple scopes` needs `--scope`                                                                                                                                                                                                                                                                                                                                       |
| Connected but no tools                             | Server started but registered none — usually a missing required env var (API key); pass `--env KEY=value` or set `env` in the `.mcp.json` entry                                                                                                                                                                                                                                                                                                                                 |
| Connection timed out at startup                    | Server exceeded the default 30s startup timeout (a first `npx` run can be slow while the package downloads) — raise `MCP_TIMEOUT` in ms, e.g. `MCP_TIMEOUT=60000 claude` (PowerShell: `$env:MCP_TIMEOUT = "60000"; claude`)                                                                                                                                                                                                                                                     |
| OAuth sign-in fails or browser doesn't open        | Run `/mcp`, select the server, choose `Authenticate` again; if the browser doesn't open, copy the URL shown in the terminal and open it manually. Fixed callback ports and pre-configured credentials: see OAuth options                                                                                                                                                                                                                                                        |
| `.mcp.json` edits ignored                          | Read at session start — restart the session; if you rejected the server earlier, run `claude mcp reset-project-choices`                                                                                                                                                                                                                                                                                                                                                         |

### Diagnosing `Failed to connect`

- `✘ Failed to connect`: read the failure detail on the status first (`claude mcp list` / `claude mcp get <name>` — HTTP status or error code + server text often names the missing header or rejected token). `✘ Connection error` carries no detail — go straight to the checks below.
- HTTP server: `curl -I <url>` (PowerShell: `curl.exe`). `404`/`405` → server is up (many MCP endpoints answer only POST); `401`/`403` → server is up, authenticate (browser sign-in, or `--header "Authorization: Bearer <token>"` for token-based servers like GitHub's); no response → check the URL and network.
- HTTP `404 Not Found` → `/mcp` shows `MCP endpoint not found at <origin>. Check the URL in your MCP config.`; run `claude mcp get <name>`, compare the path to the server's documented MCP endpoint, then `claude mcp remove <name>` and re-add with the correct URL.
- stdio server: run the configured command directly. Starts and waits for input → server works; run `claude mcp get <name>` and compare its command to what you ran (a mismatch means `--` was omitted; for a hand-written `.mcp.json`, check syntax and location). Errors → the message names what is missing (Node.js, a browser).

## Cross-references (one level deep)

- Channels: a server with the `claude/channel` capability, opted in via `--channels` at startup, pushes messages into the session. See `/en/channels`, `/en/channels-reference`.
- Elicitation: servers request structured input mid-task (form or URL mode) — dialogs appear automatically; auto-respond via the `Elicitation` hook (`/en/hooks#elicitation`). URL mode passes the URL as a command-line argument to the system URL handler and caps its length: over the cap (counted after escaping), you can only decline. Each character needing escaping (e.g. `%`, `&`) counts 4×; a URL with none reaches the cap at about 8,000 characters, one where every third character is `%` at roughly 4,000.
- Resources: reference via `@server:protocol://resource/path` mentions. MCP Apps UI resources (`ui://` URI or `text/html;profile=mcp-app` media type) are omitted from `@` suggestions and the resource-list tool (a server offering only those shows an empty list); reading one by URI still works.
- `claude mcp serve` — run Claude Code itself as a stdio MCP server. Prints nothing on start (a silent blocked terminal means it is running); exposes only Claude Code's tools, so the MCP client must implement per-call user confirmation. If `claude` isn't on PATH, put the full path in the client's `command` (else `spawn claude ENOENT`).
- `claude mcp add-from-claude-desktop` — import Claude Desktop servers (macOS/WSL). Names with characters outside letters/numbers/hyphens/underscores are reported and skipped; duplicate names get a numeric suffix (e.g. `server_1`).
- `CLAUDE_CONFIG_DIR` env var relocates `.claude.json`.
- OTEL: `OTEL_LOG_TOOL_DETAILS=1` includes MCP server/tool names in tool events (see `/en/monitoring-usage`).
- Managed/enterprise MCP restrictions (`managed-mcp.json`, `allowedMcpServers`/`deniedMcpServers`, `allowManagedMcpServersOnly`, `allowAllClaudeAiMcps`): see `claude-code-mcp-managed-reference.md`.

## Version notes

| version >= | Feature                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1.64     | `oauth.authServerMetadataUrl` field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2.1.121    | `alwaysLoad` field; HTTP/SSE initial connection retried up to 3× on transient errors (5xx, refused, timeout) before marking failed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2.1.129    | Org per-tool controls (`ask` / `blocked`) on claude.ai connectors enforced locally                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2.1.161    | Unused claude.ai connectors collapse behind `Show unused connectors` row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.1.162    | Per-server `timeout` < 1000 now ignored (was floored to 1s); Anthropic-hosted connectors (M365/Gmail/Calendar) direct local-OAuth to claude.ai Settings → Connectors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2.1.186    | `claude mcp login <name>` / `claude mcp logout <name>` CLI OAuth commands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2.1.187    | Remote MCP tool calls idle >5min abort via `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2.1.191    | Post-connection capability discovery (`tools/list`/`prompts/list`/`resources/list`) retries transient errors up to 3×; `claude mcp login` auto-detects no local browser and supports `--no-browser`; HTTP 404 shows `MCP endpoint not found at <url>` in `/mcp` (was a generic `Error POSTing to endpoint`)                                                                                                                                                                                                                                                                                                                                            |
| 2.1.193    | `headersHelper` auto-retries once on 401/403 with fresh headers; startup notice when a configured server needs authentication                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2.1.195    | `headersHelper` cwd = plugin root for plugin-provided servers; rejected token refresh shows a `/mcp` Re-authenticate notice; root-level `anyOf`/`oneOf`/`allOf` tool schemas are flattened instead of skipped                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2.1.196    | Non-interactive (`claude -p`/Agent SDK) runs report an unauthorized server's tools as unavailable-until-authorized; `claude mcp list`/`get` restrict `.mcp.json` approval reads to untrusted-folder-safe settings sources; unset `oauth.scopes` now requests only the `WWW-Authenticate`/protected-resource scope, not the full autodiscovered catalog                                                                                                                                                                                                                                                                                                 |
| 2.1.199    | `_meta["anthropic/requiresUserInteraction"]` tool annotation forces a permission prompt on every call                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2.1.202    | `url`-without-`type` config entries report a specific error naming the field (was a generic `command: expected string, received undefined`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.1.203    | Stdio servers get the 30-min idle timeout (previously exempt); a per-server `timeout` >= 1000 floors the idle timeout; `roots/list` includes granted additional working dirs + sends `notifications/roots/list_changed`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2.1.205    | `Claude Browser` name reserved; ToolSearch surfaces a failed server's connection error to Claude (previously silent); Claude Desktop import skips only invalid names and reports each, instead of aborting the whole import                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.1.206    | A `401` on an already-signed-in OAuth server refreshes the token, reconnects, and retries once (previously a transient refresh failure flagged the server for the rest of the session)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2.1.207    | An untracked `.claude/settings.local.json` applies its `.mcp.json` approvals only after a trust dialog for that folder or a parent (config home exempt); a plugin-provided `headersHelper` no longer substitutes `${user_config.*}` and the server is reported misconfigured                                                                                                                                                                                                                                                                                                                                                                           |
| 2.1.208    | A remote server with an empty `url` shows as `not configured` and is not connected (was reported as a configuration issue with a reconnect prompt)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2.1.210    | `/reload-plugins` (and an Agent SDK server-list replace that doesn't name a plugin server) keeps live connections of plugin servers whose config is unchanged (was: any unnamed plugin server disconnected)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.1.211    | In web sessions an MCP call to a not-yet-connected plugin server starts it on demand and waits (previously failed until the next message started a turn)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.1.212    | Main-conversation MCP tool calls past 2 min auto-background to a task (`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2.1.214    | A failed `list_changed` refresh keeps the previously discovered tools/prompts/resources (was replaced with an empty list); one-tap approval withheld for prompts only the terminal dialog can render in full                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2.1.216    | Claude Code excludes a tool whose input schema would make the API reject the whole request (bad top-level property names, or invalid against the JSON Schema 2020-12 meta-schema) instead of failing every request that includes it; on deployments without feature-flag fetching, the check is only logged and the API still 400s that request                                                                                                                                                                                                                                                                                                        |
| 2.1.218    | The server-needs-authentication startup notice counts only servers signable-in from Claude Code (previously also counted claude.ai connectors not connected in claude.ai)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2.1.219    | `claude mcp list`/`get` append failure detail (status/error text, redacted) to `✘ Failed to connect` (was bare status); HTTP 404 shows the URL origin only (was the full path); `--output-format stream-json` reports a skipped `--mcp-config` entry in `system/init`'s `mcp_server_errors`                                                                                                                                                                                                                                                                                                                                                            |
| 2.1.221    | Remote-server discovery cache / `cached` status in `/mcp` (`MCP_DISCOVERY_CACHE=0` disables); Google Cloud's Agent Platform tool-search default now follows model generation (previously off for every GCAP model unless `ENABLE_TOOL_SEARCH=true`)                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2.1.222    | A claude.ai connector rejected by claude.ai's session-token check shows a distinct `connected · session token rejected` state, cleared by `/login` + reconnect (previously flagged as needing authentication, which re-authorizing didn't fix)                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2.1.227    | Managed settings can keep tool search on despite `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2.1.229    | Bug: OAuth callback sent `http://127.0.0.1:PORT/callback` instead of `http://localhost:PORT/callback`; servers that exact-match the registered redirect URI rejected sign-in — workaround: add the `127.0.0.1` form to the server's registered redirect URIs, or upgrade to 2.1.231                                                                                                                                                                                                                                                                                                                                                                    |
| 2.1.231    | OAuth callback URI restored to `http://localhost:PORT/callback` (reverts 2.1.229 regression)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2.1.232    | The v2 MCP client runtime (MCP TypeScript SDK 2.0, protocol revision 2026-07-28) becomes the default, picked per session start; `MCP_SDK_GENERATION` pins v1/v2, `MCP_PROTOCOL_NEGOTIATION` controls whether Claude Code asks a server for the newer revision                                                                                                                                                                                                                                                                                                                                                                                          |
| 2.1.238    | `claude mcp list`/`get` stop connecting to a `disabledMcpServers`-listed server to health-check it, reporting `⊘ Disabled for this project` without connecting; MCP discovery cache defaults to off unless a gradual rollout enabled it (was on by default); a project/local-scope `headersHelper` now waits for that exact folder's trust dialog even in `claude -p`/SDK sessions (was: `-p`/SDK ran regardless of trust, interactive ran once any parent folder was trusted); a user-scope/managed/connector `headersHelper`, and one for an agent-file server outside the project, now runs from the config dir instead of the invocation directory |
| 2.1.246    | `--strict-mcp-config` skips the approval wait for project-scoped servers it isn't loading anyway (was: still waited, stalling background/non-interactive startup); moving the session with `/cd` connects/disconnects plugin MCP servers for the new directory's enabled plugins without needing `/reload-plugins`                                                                                                                                                                                                                                                                                                                                     |
| 2.1.259    | A server provided via the managed `managedMcpServers` setting outranks local/project/user/plugin/connector scope on a duplicate (matched by endpoint)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2.1.265    | `claude mcp add --transport http` auto-switches to SSE when the server doesn't accept HTTP (was: pass `--transport sse` explicitly)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2.1.268    | A local/project/user-scope server's `/mcp` detail view shows a `${VAR}` reference by name rather than its resolved value, matching `claude mcp list`/`get`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2.1.274    | The v2 MCP client runtime becomes the default in sessions that don't fetch feature flags too (Bedrock/AWS/GCAP/Foundry, Claude-apps-gateway sign-in, telemetry/feature-flags off) — previously those stayed on v1 even after 2.1.232                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2.1.280    | `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` changes the 2,048-character truncation limit on tool descriptions and server instructions for every MCP server in the session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2.1.283    | MCP image tool results: the original bytes are also saved to a file in the session's `tool-results` directory and the path is given to Claude                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2.1.284    | `/mcp reconnect all` works in the interactive terminal (earlier: `MCP server "all" not found`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2.1.285    | `claude mcp get` prints a `Command` line for a stdio entry saved without a `type` field (earlier: no `Command` line; `claude mcp list` printed it either way); a tool's `_meta["anthropic/alwaysLoad"]: false` keeps it deferred when the server config sets `alwaysLoad: true` (servers from `--mcp-config`, an Agent SDK app, or a plugin)                                                                                                                                                                                                                                                                                                           |
| 2.1.287    | Server-level `"alwaysLoad": false` defers every tool of the server, including tools the author marked to load upfront via `_meta["anthropic/alwaysLoad"]: true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
