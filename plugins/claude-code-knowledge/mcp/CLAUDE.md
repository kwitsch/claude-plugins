# CLAUDE.md — claude-code-knowledge/mcp

`mcp/server.mjs` backs the `claude-code-guide` reroute hook (`hooks/hooks.json` + `.mcp.json`). Generic `mcp_tool` hook rules live in `.claude/rules/hooks-mcp-server.md` — not restated here.

## Hook wiring

- Event: `PreToolUse`, matcher `Agent|Task`, handler `mcp_tool`, tool `reroute_guide`.
- Server name in `hooks.json` is `plugin:claude-code-knowledge:claude-code-knowledge-hooks` — the runtime-namespaced name from `claude mcp list`, NOT the bare `.mcp.json` key (`claude-code-knowledge-hooks`). The bare key fails with "MCP server not connected".

## Behavior

- Rewrites `tool_input.subagent_type` from `claude-code-guide` to `claude-code-knowledge:claude-code-expert` via `permissionDecision: "allow"` + `updatedInput`, returned as the tool's text output, which Claude Code parses as the hook decision.
- No-op for any other subagent type.
- Loop-safe: the rewrite target is not `claude-code-guide`.
- Fail-open: when the server is not connected, the guide simply runs un-rerouted.

## Server

- Self-contained, zero-dep; keep it executable (`100755`).
- `.mcp.json` launches it through `bin/mjs-launch.sh` (bun-preferred, node fallback).
- It is the plugin's only MCP server; there is no runtime doc cache.
