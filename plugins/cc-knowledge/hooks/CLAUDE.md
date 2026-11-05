# CLAUDE.md — cc-knowledge/hooks

## Reroute mod

A mods function-hooks module (layout and module rules as `plugins/CLAUDE.md` `## Mods function-hooks modules`); no hook process, no MCP server.

- `hooks/hooks.json` — exactly `{"modules": ["./register.ts"]}`.
- `hooks/register.ts` — one `tool.call` hook, matcher `{ tool: ["Agent", "Task"] }`. It calls `next` with `subagent_type` from `rerouteType`; every other call passes as is.
- `hooks/reroute.mjs` — pure, zero-dep, JSDoc-typed (`normalize`, `rerouteType`, `REROUTE_TARGET`); never references `$`. Executable (`100755`, hooks-executable rule).
- Behavior: any spelling of `claude-code-guide` (lowercased, separator runs collapsed to `-`) runs as `cc-knowledge:claude-code-expert`, other arguments kept. Loop-safe: the target is not a guide. Main loop and subagents alike.
- Fail-open: no `.catch`, so a throwing hook is skipped and the guide runs un-rerouted, as the former `mcp_tool` hook did when its server was down.
- No permission override: the former hook's `permissionDecision: "allow"` only carried its `updatedInput`. A mods rewrite needs none, and Agent calls raise no prompt in `default` mode (live-verified on 2.1.302).
- `.claude-plugin/types/` is engine-written and gitignored.
- Renamed from `claude-code-knowledge` in 2.0.0: Claude Code 2.1.302 reserves third-party plugin names starting with `claude-`. Installs keyed `claude-code-knowledge@kwitsch-plugins` must be replaced by `cc-knowledge@kwitsch-plugins`; skill and agent namespaces moved from `claude-code-knowledge:` to `cc-knowledge:`.
