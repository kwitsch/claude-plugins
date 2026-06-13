---
paths:
  - "plugins/branch-management/skills/**"
  - "plugins/branch-management/agents/*.md"
---

# Rule: context-mode routing for branch-management inline scripts

context-mode is an **optional** accelerator (not a declared dependency). Every
branch-management skill/agent that runs a **read-only** runtime script — inline
shell or a `.sh` file that only emits output and performs **no persistent
filesystem/git writes** — MUST carry the canonical routing block below verbatim,
and list `mcp__plugin_context-mode_context-mode__*`, `mcp__context-mode__*`
(short alias), `ToolSearch`, and `Bash` in its `tools:` (agents) /
`allowed-tools:` (skills).

**Forbidden on state-mutating scripts.** The ctx execute sandbox discards host
filesystem/git writes, so scripts that write files or mutate git (e.g.
`graphify-update`, `clean-branches.sh`) MUST run on the native Bash tool only —
never wrap them in the routing block.

**Exemptions:** `!` / ` ```! ` dynamic-context-injection blocks (skill-load
preprocessing — they run before any tool exists, so they cannot route) and
trivial output-less one-liners.

See also the script-authoring rule (`script-authoring.md`).

## Canonical routing block (verbatim)

> **context-mode routing (optional acceleration).** When you run the script below,
> prefer context-mode's execute tool so large output stays out of your context;
> fall back to Bash when it is absent — context-mode is optional, never block on it.
> This applies ONLY to read-only scripts (no persistent filesystem/git writes); the
> ctx sandbox discards writes, so state-mutating scripts MUST run on the native Bash
> tool instead.
> 1. Load the tool once:
>    `ToolSearch(query: "select:mcp__plugin_context-mode_context-mode__ctx_execute,mcp__plugin_context-mode_context-mode__ctx_execute_file")`.
>    If nothing matches, retry the bare names (`select:ctx_execute,ctx_execute_file`)
>    as a robustness guard. Do not fall back just because the schema has not loaded yet.
> 2. Tool available → run through `…__ctx_execute` (inline shell `code`) or
>    `…__ctx_execute_file` (a `.sh` file on disk); keep only the parsed result.
> 3. Tool genuinely unavailable → run via Bash and append `context-mode unavailable —
>    ran via Bash` to your result.
