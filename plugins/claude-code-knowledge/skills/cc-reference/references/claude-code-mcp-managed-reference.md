# Claude Code MCP — Managed / Enterprise Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (Managed MCP), verified 2026-07-10.
> Apply when deploying or troubleshooting enterprise MCP restrictions (`managed-mcp.json`,
> allowlists/denylists). See `claude-code-mcp-reference.md` for general MCP config/auth/naming.

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

## Allowlists and denylists

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

## Evaluation order

1. Merge lists from all settings sources (when `allowManagedMcpServersOnly: true`, only managed allowlist is kept; denylist always merges from all sources).
2. Denylist check: any match → blocked; nothing overrides.
3. Allowlist check: if `allowedMcpServers` not set anywhere → all remaining load. If set: remote (HTTP/SSE) must match a `serverUrl` entry (a `serverName` match counts only when no `serverUrl` entries exist); stdio must match a `serverCommand` entry (a `serverName` match counts only when no `serverCommand` entries exist).

## URL wildcard matching rules

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

## `allowManagedMcpServersOnly`

- When `true`, only the managed allowlist applies; users cannot broaden it via `~/.claude/settings.json`.
- Separate from `allowManagedPermissionRulesOnly` (controls permission rules, not MCP).

## `allowAllClaudeAiMcps`

- Set in managed settings to load claude.ai connectors alongside `managed-mcp.json` servers.
- Allowlists and denylists still apply to those connectors. Affects only claude.ai connectors — plugin-provided servers stay suppressed.
- Has no effect when placed in user or project settings; must come from admin-controlled tiers. version >= 2.1.149

## Version notes

| version >= | Feature |
|---|---|
| 2.1.149 | `allowAllClaudeAiMcps` setting |
| 2.1.182 | `serverName` in `deniedMcpServers` accepts any non-empty string |
