---
paths:
  - "plugins/*/skills/**"
  - "plugins/*/agents/*.md"
---

# Rule: cave-context routing for skills & agents

cave-context is an **optional** accelerator (the cave-context MCP server, which
proxies context-mode). Any skill or agent that runs **read-only / output-heavy**
shell, or **fetches information from the internet**, SHOULD route that work through
cave-context when its tools are available — keeping large output / raw page bytes out
of context for leaner, faster turns — and fall back to native tools when absent.
**Never block on cave-context.**

Such a file carries the canonical routing block below in its body and grants the
matching cave-context tools (plus `ToolSearch`, since the tools are deferred) in its
`tools:` (agents) / `allowed-tools:` (skills), matching the file's existing
frontmatter style (JSON array vs bare comma list).

## Which grant

- **Shell files** (run read-only/output-heavy shell; already hold `Bash`) → grant the
  wildcard `mcp__plugin_cave-context_cave-context__*` (needs `ctx_execute` +
  `ctx_batch_execute`). A file already granting `Bash` has no capability concern.
- **Read-only / fetch-only files** (fetch the internet, hold no `Bash`/write tools —
  e.g. read-only Q&A or lookup agents) → grant ONLY
  `mcp__plugin_cave-context_cave-context__ctx_fetch_and_index` and
  `mcp__plugin_cave-context_cave-context__ctx_search`, NOT the wildcard. The wildcard
  would hand a deliberately read-only file `ctx_execute` (arbitrary sandboxed shell);
  the two fetch/search tools preserve its read-only nature.

## Do NOT carry the block

Skills/agents whose shell is **purely state-mutating** (e.g. `configure-*` writing
settings, git-lifecycle skills) or that only **orchestrate** (dispatch subagents,
no direct heavy shell / fetch) do NOT carry the block and do NOT get a cave-context
grant — routing their writes would break them (the ctx sandbox discards writes), and
an unused grant is dead surface.

## Canonical routing block — shell variant (verbatim)

For files that run read-only/output-heavy shell:

> ## cave-context routing (optional acceleration)
>
> If the cave-context MCP tools are available, route heavy work through them so large
> output stays out of context — leaner, faster turns. Fall back to native tools when
> absent; never block on cave-context.
>
> - **Read-only / output-heavy shell** (no filesystem or git writes) → run via
>   `ctx_execute` (one command) or `ctx_batch_execute` (several), printing only the
>   answer. Load the tools once with
>   `ToolSearch(query: "select:mcp__plugin_cave-context_cave-context__ctx_execute,mcp__plugin_cave-context_cave-context__ctx_batch_execute")`
>   (retry the bare names `select:ctx_execute,ctx_batch_execute`); if neither
>   resolves, run the command via Bash.
> - **State-mutating shell** (writes files, `git` commits/pushes, edits settings) →
>   always native Bash; the ctx sandbox discards filesystem and git writes.

## Canonical routing block — fetch variant (verbatim)

For files that fetch the internet:

> ## cave-context routing (optional acceleration)
>
> If the cave-context MCP tools are available, fetch internet content through them so
> raw page bytes stay out of context — leaner, faster turns. Fall back to WebFetch
> when absent; never block on cave-context.
>
> - **Fetching information from the internet** → `ctx_fetch_and_index(url, source)`
>   then `ctx_search(queries)`, keeping only the matched sections. Load the tool once
>   with `ToolSearch(query: "select:mcp__plugin_cave-context_cave-context__ctx_fetch_and_index")`
>   (retry the bare name `select:ctx_fetch_and_index`); if it does not resolve, use
>   WebFetch.
