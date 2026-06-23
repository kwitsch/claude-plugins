# LSP-first symbol search

When you are about to search for a **code identifier** — a name shaped like a
programming-language symbol — query the `LSP` tool **before** running
`grep` / `rg` / the `Grep` tool.

Symbol-shaped names — use LSP first:
- **camelCase** — `getUserById`, `parseConfig`
- **PascalCase** — `UserService`, `HttpClient`
- **snake_case** (≥ 3 segments, length ≥ 9) — `get_user_by_id`, `parse_config_file`
- **dotted member access** — `router.refresh`, `config.load`

How:
1. `LSP` with `operation: "workspaceSymbol"` and the name as `query` — locate
   the symbol by name across the workspace.
2. `LSP` `goToDefinition` / `findReferences` / `documentSymbol` — read or trace
   it.
3. Fall back to `grep` only if LSP returns nothing, or the target is not a code
   symbol.

Not symbol-shaped — `grep` is fine: prose, `SCREAMING_SNAKE_CASE` constants /
env vars, short all-lowercase words, plain `kebab-case` filenames, log / error
strings.

One LSP call is more precise and cheaper than scanning files with `grep`.
